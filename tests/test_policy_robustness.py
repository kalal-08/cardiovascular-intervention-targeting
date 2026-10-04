from hashlib import sha256
import importlib
import importlib.util
from pathlib import Path
import subprocess

import numpy as np
import pandas as pd
import pytest


ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
POLICIES = {"grf", "simple", "baseline_risk"}
NONFULL_ANCHORS = {13, 32, 64, 95}
ALL_ANCHORS = {*NONFULL_ANCHORS, 127}
PHASE11A = (
    "policy_uncertainty_curve.csv",
    "anchor_policy_uncertainty.csv",
    "anchor_pairwise_uncertainty.csv",
    "capacity_advantage_labels.csv",
    "policy_bootstrap_metadata.csv",
)
UPSTREAM = (
    "village_folds.csv",
    "grf_model_metadata.csv",
    "hte_oov_predictions.csv",
    "hte_evaluation_scores.csv",
    "aipw_overall_summary.csv",
    "village_benefit_summary.csv",
    "village_aggregation_diagnostics.csv",
    "policy_village_priorities.csv",
    "policy_capacity_curve.csv",
    "policy_anchor_summary.csv",
    "policy_anchor_differences.csv",
    "policy_anchor_overlap.csv",
)


def file_hashes(names):
    return {name: sha256((DERIVED / name).read_bytes()).hexdigest() for name in names}


def load_module():
    try:
        from intervention_targeting import policy_robustness
    except ImportError:
        pytest.fail("Phase-11B policy_robustness module is missing")
    return policy_robustness


@pytest.fixture(scope="module")
def module():
    return load_module()


@pytest.fixture(scope="module")
def inputs(module):
    return module.load_phase11b_inputs(ROOT)


def test_phase11b_inputs_reconcile_frozen_phase11a_and_populations(module, inputs):
    (
        villages,
        priorities,
        primary_curve,
        scores,
        cohort,
        anchor_uncertainty,
        pairwise_uncertainty,
        advantage_labels,
    ) = inputs

    assert module.phase11a_hashes(ROOT) == file_hashes(PHASE11A) | {
        "policy_value_uncertainty.png": sha256(
            (ROOT / "reports" / "figures" / "policy_value_uncertainty.png").read_bytes()
        ).hexdigest(),
        "policy_gain_uncertainty.png": sha256(
            (ROOT / "reports" / "figures" / "policy_gain_uncertainty.png").read_bytes()
        ).hexdigest(),
    }
    assert len(villages) == villages["village_id"].nunique() == 127
    assert villages.groupby("W").size().to_dict() == {0: 63, 1: 64}
    assert len(priorities) == priorities["village_id"].nunique() == 127
    assert len(primary_curve) == 384
    assert len(scores) == scores["ID"].nunique() == 4_508
    assert len(cohort) == cohort["ID"].nunique() == 4_533
    assert cohort["village_id"].nunique() == 127
    assert len(anchor_uncertainty) == 15
    assert len(pairwise_uncertainty) == len(advantage_labels) == 12
    assert set(anchor_uncertainty.query("capacity_villages < 127")[
        "policy_vs_random_classification"
    ]) == {"INCONCLUSIVE"}
    assert set(advantage_labels["capacity_advantage_label"]) == {
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    }


def test_raw_global_ranking_uses_only_locked_raw_signals_and_complete_path(module, inputs):
    villages, priorities, primary_curve, scores, *_ = inputs
    before = priorities.copy()
    raw_priorities = module.build_raw_global_priorities(villages)
    raw = module.build_raw_ranking_robustness(
        villages, priorities, primary_curve, scores, raw_priorities
    )

    assert module.RAW_POLICY_SIGNALS == {
        "grf": "mean_benefit_grf_oov",
        "simple": "mean_benefit_simple_oov",
        "baseline_risk": "mean_risk0",
    }
    assert len(raw) == 384
    assert set(raw["policy"]) == POLICIES
    assert set(raw["capacity_villages"]) == set(range(128))
    assert not raw.duplicated(["policy", "capacity_villages"]).any()
    for policy, signal in module.RAW_POLICY_SIGNALS.items():
        rank = f"{module.POLICY_PREFIXES[policy]}_raw_global_rank"
        expected = villages.assign(
            _tie=villages["village_id"].map(
                lambda value: sha256(f"village:{value}".encode()).hexdigest()
            )
        ).sort_values([signal, "_tie"], ascending=[False, True])["village_id"].tolist()
        actual = raw_priorities.sort_values(rank)["village_id"].tolist()
        assert actual == expected
        assert set(raw_priorities[rank]) == set(range(1, 128))

    changed = villages.assign(
        W=1 - villages["W"],
        gamma_benefit=np.arange(127),
        risk4=np.arange(127),
        delta_risk=-np.arange(127),
        treatment=np.arange(127) % 2,
    )
    pd.testing.assert_frame_equal(
        raw_priorities,
        module.build_raw_global_priorities(changed),
    )
    pd.testing.assert_frame_equal(priorities, before)
    endpoints = raw.loc[raw["capacity_villages"].isin([0, 127])]
    assert endpoints.loc[endpoints["capacity_villages"].eq(0), "shared_villages"].eq(0).all()
    assert endpoints.loc[endpoints["capacity_villages"].eq(0), "jaccard_overlap"].eq(1).all()
    assert endpoints.loc[endpoints["capacity_villages"].eq(127), "shared_villages"].eq(127).all()
    assert endpoints.loc[endpoints["capacity_villages"].eq(127), "jaccard_overlap"].eq(1).all()
    assert set(raw["raw_ranking_stability"]) <= {"STABLE", "SENSITIVE"}


def test_raw_stability_rule_detects_material_reversals():
    spec = importlib.util.find_spec("intervention_targeting.policy_robustness")
    assert spec is not None, "Phase-11B policy_robustness module is missing"
    module = importlib.import_module("intervention_targeting.policy_robustness")
    assert module.classify_raw_stability([0.1], [0.2], ["a>b"], ["a>b"], [0.8]) == "STABLE"
    assert module.classify_raw_stability([0.1], [-0.1], ["a>b"], ["a>b"], [0.8]) == "SENSITIVE"
    assert module.classify_raw_stability([0.1], [0.2], ["a>b"], ["b>a"], [0.8]) == "SENSITIVE"
    assert module.classify_raw_stability([0.1], [0.2], ["a>b"], ["a>b"], [0.49]) == "SENSITIVE"


def test_equal_village_sensitivity_uses_127_means_and_primary_membership(module, inputs):
    villages, priorities, primary_curve, scores, *_ = inputs
    result = module.build_equal_village_sensitivity(
        villages, priorities, primary_curve, scores
    )
    village_means = scores.groupby("village_id")["gamma_benefit"].mean()
    selected = set(priorities.loc[priorities["grf_eval_rank"].le(13), "village_id"])
    row = result.query("policy == 'grf' and capacity_villages == 13").iloc[0]

    assert len(village_means) == 127
    assert len(result) == 15
    assert set(result["capacity_villages"]) == ALL_ANCHORS
    assert np.isclose(
        row["equal_village_rollout_value"], village_means.loc[list(selected)].sum() / 127
    )
    assert np.isclose(
        row["equal_village_random_expected"], 13 / 127 * village_means.mean()
    )
    assert np.isclose(
        row["equal_village_gain_vs_random"],
        row["equal_village_rollout_value"] - row["equal_village_random_expected"],
    )
    assert set(result["estimand_label"]) == {
        "EQUAL-VILLAGE SENSITIVITY - NOT PRIMARY ESTIMAND"
    }
    assert set(result["equal_village_consistency"]) <= {"CONSISTENT", "DIFFERENT"}
    full = result.query("capacity_villages == 127")
    assert np.allclose(full["equal_village_rollout_value"], village_means.mean())
    assert np.allclose(full["equal_village_gain_vs_random"], 0, atol=1e-12)


def test_leave_one_village_out_keeps_ranks_and_detects_sign_changes(module, inputs):
    villages, priorities, _, scores, *_ = inputs
    deletions, summary = module.build_village_influence(priorities, scores)

    assert len(deletions) == 127 * 4 * 3
    assert deletions.groupby(["capacity_villages", "comparison"]).size().eq(127).all()
    assert set(deletions["capacity_villages"]) == NONFULL_ANCHORS
    assert len(summary) == 12
    assert summary["n_village_deletions"].eq(127).all()
    assert pd.api.types.is_integer_dtype(summary["max_abs_change_village_id"])
    assert set(summary["influence_classification"]) <= {
        "ROBUST TO SINGLE-VILLAGE DELETION",
        "SENSITIVE TO SINGLE-VILLAGE DELETION",
    }
    deleted = villages.iloc[0]["village_id"]
    capacity = 13
    remaining = scores.loc[scores["village_id"].ne(deleted)]
    denominator = len(remaining)
    expected = []
    for policy in ("grf", "simple"):
        rank = f"{module.POLICY_PREFIXES[policy]}_eval_rank"
        selected = set(priorities.loc[priorities[rank].le(capacity), "village_id"])
        expected.append(
            remaining.loc[remaining["village_id"].isin(selected), "gamma_benefit"].sum()
            / denominator
        )
    actual = deletions.query(
        "capacity_villages == 13 and comparison == 'grf_minus_simple' "
        "and deleted_village_id == @deleted"
    ).iloc[0]["leave_one_village_out_difference"]
    assert np.isclose(actual, expected[0] - expected[1])
    assert module.has_sign_change(0.1, np.array([0.2, -0.01]))
    assert not module.has_sign_change(0.1, np.array([0.2, 0.01]))


def test_equity_reuses_five_verified_phase6_mappings_and_whole_villages(module, inputs):
    _, priorities, _, _, cohort, *_ = inputs
    equity = module.build_equity_coverage_summary(cohort, priorities)

    assert len(equity) == 3 * 5 * 5 * 2
    assert set(equity["policy"]) == POLICIES
    assert set(equity["capacity_villages"]) == ALL_ANCHORS
    assert set(equity["dimension"]) == {"age", "sex", "education", "occupation", "income"}
    assert set(equity["mapping_status"]) == {"VERIFIED"}
    assert equity["n_subgroup_total"].gt(0).all()
    assert np.allclose(
        equity["subgroup_coverage"], equity["n_subgroup_covered"] / equity["n_subgroup_total"]
    )
    assert np.allclose(
        equity["overall_randomized_coverage"], equity["n_overall_covered"] / 4_533
    )
    assert np.allclose(
        equity["coverage_gap"],
        equity["subgroup_coverage"] - equity["overall_randomized_coverage"],
    )
    full = equity.query("capacity_villages == 127")
    assert full["n_overall_covered"].eq(4_533).all()
    assert full[["subgroup_coverage", "overall_randomized_coverage"]].eq(1).all().all()
    assert np.allclose(full["coverage_gap"], 0, atol=1e-12)

    selected = set(priorities.loc[priorities["grf_eval_rank"].le(13), "village_id"])
    subgroup = cohort.loc[cohort["age"].lt(60)]
    row = equity.query(
        "policy == 'grf' and capacity_villages == 13 and dimension == 'age' "
        "and category == '<60 years'"
    ).iloc[0]
    assert row["n_subgroup_total"] == len(subgroup)
    assert row["n_subgroup_covered"] == subgroup["village_id"].isin(selected).sum()

    changed = cohort.assign(
        risk4=np.arange(len(cohort)),
        delta_risk=-np.arange(len(cohort)),
        primary_outcome_observed=False,
        gamma_benefit=np.arange(len(cohort)),
    )
    pd.testing.assert_frame_equal(equity, module.build_equity_coverage_summary(changed, priorities))


def test_covered_baseline_risk_is_descriptive_and_reconciles_full_rollout(module, inputs):
    _, priorities, _, _, cohort, *_ = inputs
    result = module.build_covered_baseline_risk_summary(cohort, priorities)
    selected = set(priorities.loc[priorities["risk_eval_rank"].le(13), "village_id"])
    values = cohort.loc[cohort["village_id"].isin(selected), "risk0"]
    row = result.query("policy == 'baseline_risk' and capacity_villages == 13").iloc[0]

    assert len(result) == 15
    assert row["n_covered"] == len(values)
    assert np.isclose(row["covered_mean_risk0"], values.mean())
    assert np.isclose(row["covered_median_risk0"], values.median())
    assert np.isclose(row["overall_randomized_mean_risk0"], cohort["risk0"].mean())
    full = result.query("capacity_villages == 127")
    assert full["n_covered"].eq(4_533).all()
    assert np.allclose(full["covered_mean_minus_overall"], 0, atol=1e-12)


def test_final_synthesis_cannot_upgrade_failed_phase11a_gate(module, inputs):
    (
        villages,
        priorities,
        primary_curve,
        scores,
        cohort,
        anchor_uncertainty,
        pairwise_uncertainty,
        advantage_labels,
    ) = inputs
    raw_priorities = module.build_raw_global_priorities(villages)
    raw = module.build_raw_ranking_robustness(
        villages, priorities, primary_curve, scores, raw_priorities
    )
    equal = module.build_equal_village_sensitivity(villages, priorities, primary_curve, scores)
    _, influence = module.build_village_influence(priorities, scores)
    summary, conclusion = module.build_final_policy_robustness_summary(
        anchor_uncertainty,
        pairwise_uncertainty,
        advantage_labels,
        raw,
        equal,
        influence,
    )

    assert len(summary) == 12
    assert set(summary["phase11a_gain_classification"]) == {"INCONCLUSIVE"}
    assert set(summary["phase11a_capacity_advantage_label"]) == {
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    }
    assert conclusion.iloc[0]["final_phase11_conclusion"] == (
        "NO SINGLE ROBUST POLICY WINNER ESTABLISHED"
    )
    assert not bool(conclusion.iloc[0]["global_winner_established"])
    notable = conclusion.iloc[0]
    assert notable["notable_paired_comparison"] == "simple_minus_baseline_risk_at_K95"
    assert notable["notable_pairwise_classification"] == "CLEARLY POSITIVE"
    assert notable["notable_pairwise_ci_lower"] > 0
    assert not bool(notable["notable_result_is_capacity_specific_advantage"])


def test_pipeline_is_deterministic_and_preserves_phase11a_and_upstream(module):
    phase11a_before = module.phase11a_hashes(ROOT)
    upstream_before = file_hashes(UPSTREAM)

    first = module.run_phase11b_pipeline(ROOT)
    first_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in first.items()}
    second = module.run_phase11b_pipeline(ROOT)
    second_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in second.items()}

    assert first_hashes == second_hashes
    assert module.phase11a_hashes(ROOT) == phase11a_before
    assert file_hashes(UPSTREAM) == upstream_before
    assert set(first) == {
        "raw_ranking_robustness",
        "equal_village_sensitivity",
        "village_influence_summary",
        "equity_coverage_summary",
        "covered_baseline_risk_summary",
        "final_policy_robustness_summary",
        "final_phase11_conclusion",
    }
    assert not any("participant" in Path(path).name for path in first.values())
    ignored = subprocess.run(
        ["git", "check-ignore", *first.values()],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert ignored.returncode == 0


@pytest.mark.local_only
def test_pipeline_preserves_local_validation_document(module):
    document = ROOT / "docs" / "hte_validation.md"
    before = sha256(document.read_bytes()).hexdigest()
    module.run_phase11b_pipeline(ROOT)
    assert sha256(document.read_bytes()).hexdigest() == before


def test_raw_checksum_is_unchanged():
    raw = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"
    assert sha256(raw.read_bytes()).hexdigest() == (
        "2a42364e388ed21ae9b4dc0038424c3e4e4ffb60e9aebd8edef7db8d356b7741"
    )
