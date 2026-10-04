from hashlib import sha256
from pathlib import Path
import subprocess

import numpy as np
import pandas as pd

from intervention_targeting import rollout_policy


ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
ANCHORS = {13, 32, 64, 95, 127}
POLICIES = {"grf", "simple", "baseline_risk"}
UPSTREAM = (
    "village_folds.csv",
    "grf_model_metadata.csv",
    "hte_evaluation_scores.csv",
    "aipw_overall_summary.csv",
    "village_benefit_summary.csv",
    "village_aggregation_diagnostics.csv",
)


def upstream_hashes():
    return {name: sha256((DERIVED / name).read_bytes()).hexdigest() for name in UPSTREAM}


def phase10_inputs():
    return rollout_policy.load_phase10_inputs(ROOT)


def test_phase10_inputs_reconcile_frozen_upstream_contracts():
    villages, scores = phase10_inputs()
    metadata = pd.read_csv(DERIVED / "grf_model_metadata.csv").iloc[0]

    assert metadata["fold_map_hash"] == rollout_policy.EXPECTED_FOLD_HASH
    assert len(villages) == villages["village_id"].nunique() == 127
    assert villages["n_randomized"].sum() == 4_533
    assert villages["n_evaluation"].sum() == len(scores) == 4_508
    assert villages["n_missing_primary_outcome"].sum() == 25
    assert scores["gamma_benefit"].notna().all()
    assert np.isclose(scores["gamma_benefit"].mean(), rollout_policy.OVERALL_GAMMA_BENEFIT)


def test_priorities_are_three_separate_fold_normalized_outcome_blind_rankings():
    villages, _ = phase10_inputs()
    priorities = rollout_policy.build_priorities(villages)

    assert set(rollout_policy.POLICY_SIGNALS) == POLICIES
    assert len(priorities) == priorities["village_id"].nunique() == 127
    assert not any(
        token in column.lower()
        for column in priorities.columns
        for token in ("ensemble", "composite", "winner", "recommended", "final_rank", "oracle")
    )
    for policy, signal in rollout_policy.POLICY_SIGNALS.items():
        prefix = rollout_policy.POLICY_PREFIXES[policy]
        rank = f"{prefix}_eval_rank"
        percentile = f"{prefix}_priority_percentile"
        assert set(priorities[rank]) == set(range(1, 128))
        assert priorities[percentile].between(0, 1, inclusive="right").all()
        for _, group in priorities.groupby("fold"):
            ordered = group.sort_values(signal)
            assert ordered[percentile].is_monotonic_increasing

    changed = villages.assign(
        W=1 - villages["W"],
        mean_gamma_tau=10_000 - villages["mean_gamma_tau"],
        mean_gamma_benefit=-10_000 + villages["mean_gamma_benefit"],
        risk4=np.arange(len(villages)),
        delta_risk=-np.arange(len(villages)),
    )
    rank_columns = [column for column in priorities if column.endswith(("_eval_rank", "_priority_percentile"))]
    pd.testing.assert_frame_equal(
        priorities[["village_id", *rank_columns]],
        rollout_policy.build_priorities(changed)[["village_id", *rank_columns]],
    )


def test_ties_are_deterministic_and_do_not_use_treatment_or_evaluation_fields():
    villages, _ = phase10_inputs()
    pair = villages.loc[villages["fold"].eq(1)].nsmallest(2, "village_id")["village_id"].tolist()
    tied = villages.copy()
    for signal in rollout_policy.POLICY_SIGNALS.values():
        tied.loc[tied["village_id"].isin(pair), signal] = 99.0
    first = rollout_policy.build_priorities(tied)
    second = rollout_policy.build_priorities(
        tied.assign(W=1 - tied["W"], mean_gamma_benefit=np.arange(len(tied)))
    )
    columns = [column for column in first if column.endswith(("_eval_rank", "_priority_percentile"))]
    pd.testing.assert_frame_equal(first[["village_id", *columns]], second[["village_id", *columns]])
    assert first.loc[first["village_id"].isin(pair), columns].nunique().eq(2).all()


def test_capacity_curves_use_whole_nested_villages_and_participant_weighted_value():
    villages, scores = phase10_inputs()
    priorities = rollout_policy.build_priorities(villages)
    curve = rollout_policy.build_capacity_curve(priorities, scores)

    assert len(curve) == 384
    assert set(curve["policy"]) == POLICIES
    assert not any(
        token in column.lower()
        for column in curve.columns
        for token in ("ci_", "confidence", "p_value", "optimal", "winner", "recommended", "oracle")
    )
    for policy, group in curve.groupby("policy"):
        group = group.sort_values("capacity_villages")
        assert group["capacity_villages"].tolist() == list(range(128))
        assert np.array_equal(group["selected_villages"], group["capacity_villages"])
        assert group["n_selected_randomized"].is_monotonic_increasing
        assert group["n_selected_evaluation"].is_monotonic_increasing

        prefix = rollout_policy.POLICY_PREFIXES[policy]
        previous = set()
        for capacity in range(128):
            selected = set(priorities.loc[priorities[f"{prefix}_eval_rank"].le(capacity), "village_id"])
            assert len(selected) == capacity
            assert previous <= selected
            previous = selected

    np.testing.assert_allclose(curve["randomized_coverage"], curve["n_selected_randomized"] / 4_533)
    np.testing.assert_allclose(curve["evaluation_coverage"], curve["n_selected_evaluation"] / 4_508)
    np.testing.assert_allclose(
        curve["population_rollout_value"],
        curve["evaluation_coverage"] * curve["selected_mean_gamma_benefit"],
        atol=1e-12,
    )
    np.testing.assert_allclose(
        curve["random_expected_value"],
        curve["capacity_villages"] / 127 * scores["gamma_benefit"].mean(),
    )
    np.testing.assert_allclose(
        curve["value_gain_vs_random"],
        curve["population_rollout_value"] - curve["random_expected_value"],
    )

    for policy in POLICIES:
        prefix = rollout_policy.POLICY_PREFIXES[policy]
        top_village = priorities.set_index(f"{prefix}_eval_rank").loc[1, "village_id"]
        selected_scores = scores.loc[scores["village_id"].eq(top_village), "gamma_benefit"]
        row = curve.loc[curve["policy"].eq(policy) & curve["capacity_villages"].eq(1)].iloc[0]
        assert row["n_selected_evaluation"] == len(selected_scores)
        assert np.isclose(row["selected_mean_gamma_benefit"], selected_scores.mean())
        assert np.isclose(row["population_rollout_value"], selected_scores.sum() / 4_508)


def test_endpoints_anchors_pairwise_differences_and_overlap_reconcile():
    villages, scores = phase10_inputs()
    priorities = rollout_policy.build_priorities(villages)
    curve = rollout_policy.build_capacity_curve(priorities, scores)
    anchors = rollout_policy.build_anchor_summary(curve)
    differences, overlap = rollout_policy.build_anchor_comparisons(curve, priorities)
    overall = scores["gamma_benefit"].mean()

    assert len(anchors) == 15
    assert set(anchors["capacity_villages"]) == ANCHORS
    assert len(differences) == len(overlap) == 15
    assert set(differences["capacity_villages"]) == set(overlap["capacity_villages"]) == ANCHORS
    assert not any(column.startswith(("ci_", "p_")) for column in differences)
    assert overlap["jaccard_overlap"].between(0, 1).all()

    zero = curve.loc[curve["capacity_villages"].eq(0)]
    assert zero[["selected_villages", "n_selected_randomized", "n_selected_evaluation"]].eq(0).all().all()
    assert zero[["population_rollout_value", "random_expected_value", "value_gain_vs_random"]].eq(0).all().all()
    full = curve.loc[curve["capacity_villages"].eq(127)]
    assert full["n_selected_randomized"].eq(4_533).all()
    assert full["n_selected_evaluation"].eq(4_508).all()
    assert full[["randomized_coverage", "evaluation_coverage"]].eq(1).all().all()
    assert full["selected_mean_gamma_benefit"].eq(overall).all()
    assert full["population_rollout_value"].eq(overall).all()
    assert full["random_expected_value"].eq(overall).all()
    assert full["value_gain_vs_random"].eq(0).all()
    assert overlap.loc[overlap["capacity_villages"].eq(127), "shared_villages"].eq(127).all()
    assert overlap.loc[overlap["capacity_villages"].eq(127), "jaccard_overlap"].eq(1).all()


def test_pipeline_is_deterministic_preserves_upstream_and_outputs_are_bounded():
    before = upstream_hashes()
    first = rollout_policy.run_phase10_pipeline(ROOT)
    first_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in first.items()}
    second = rollout_policy.run_phase10_pipeline(ROOT)
    second_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in second.items()}

    assert first_hashes == second_hashes
    assert upstream_hashes() == before
    assert set(first) == {
        "priorities", "curve", "anchors", "differences", "overlap", "value_figure", "gain_figure"
    }
    assert all("participant" not in Path(path).name for path in first.values())
    ignored = subprocess.run(
        ["git", "check-ignore", *[path for path in first.values() if "data/derived" in Path(path).as_posix()]],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert ignored.returncode == 0


def test_raw_checksum_is_unchanged():
    raw = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"
    assert sha256(raw.read_bytes()).hexdigest() == (
        "2a42364e388ed21ae9b4dc0038424c3e4e4ffb60e9aebd8edef7db8d356b7741"
    )
