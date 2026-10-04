from hashlib import sha256
from pathlib import Path
import subprocess

import numpy as np
import pandas as pd
import pytest

from intervention_targeting import policy_uncertainty


ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
POLICIES = {"grf", "simple", "baseline_risk"}
ANCHORS = {13, 32, 64, 95, 127}
NONFULL_ANCHORS = {13, 32, 64, 95}
UPSTREAM = (
    "village_folds.csv",
    "grf_model_metadata.csv",
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


def upstream_hashes():
    return {name: sha256((DERIVED / name).read_bytes()).hexdigest() for name in UPSTREAM}


@pytest.fixture(scope="module")
def inputs():
    return policy_uncertainty.load_phase11a_inputs(ROOT)


@pytest.fixture(scope="module")
def bootstrap(inputs):
    villages, _, _, _ = inputs
    return policy_uncertainty.build_bootstrap_multiplicities(villages)


@pytest.fixture(scope="module")
def bootstrap_values(inputs, bootstrap):
    villages, priorities, _, scores = inputs
    return policy_uncertainty.bootstrap_policy_values(villages, priorities, scores, bootstrap)


def test_inputs_reconcile_frozen_phase7_through_phase10_contracts(inputs):
    villages, priorities, curve, scores = inputs
    metadata = pd.read_csv(DERIVED / "grf_model_metadata.csv").iloc[0]

    assert metadata["fold_map_hash"] == policy_uncertainty.EXPECTED_FOLD_HASH
    assert len(villages) == villages["village_id"].nunique() == 127
    assert villages.groupby("W").size().to_dict() == {0: 63, 1: 64}
    assert villages["n_randomized"].sum() == 4_533
    assert villages["n_evaluation"].sum() == len(scores) == 4_508
    assert villages["n_missing_primary_outcome"].sum() == 25
    assert scores["ID"].is_unique and scores["gamma_benefit"].notna().all()
    assert len(priorities) == priorities["village_id"].nunique() == 127
    assert len(curve) == 384
    assert set(curve["policy"]) == POLICIES
    assert not curve.duplicated(["policy", "capacity_villages"]).any()
    assert set(curve["capacity_villages"]) == set(range(128))
    assert not any(
        token in column.lower()
        for column in [*priorities.columns, *curve.columns]
        for token in ("winner", "optimal", "recommended")
    )


def test_bootstrap_is_deterministic_arm_stratified_village_resampling(inputs, bootstrap):
    villages, _, _, _ = inputs
    repeated = policy_uncertainty.build_bootstrap_multiplicities(villages)
    arms = villages.sort_values("village_id").set_index("village_id")["W"]

    pd.testing.assert_frame_equal(bootstrap, repeated)
    assert bootstrap.shape == (2_000, 127)
    assert bootstrap.index.name == "bootstrap_replicate"
    assert bootstrap.columns.name == "village_id"
    assert (bootstrap.to_numpy() >= 0).all()
    assert np.equal(bootstrap.to_numpy(), bootstrap.to_numpy().astype(int)).all()
    assert bootstrap.loc[:, arms.index[arms.eq(1)]].sum(axis=1).eq(64).all()
    assert bootstrap.loc[:, arms.index[arms.eq(0)]].sum(axis=1).eq(63).all()
    assert bootstrap.sum(axis=1).eq(127).all()


def test_bootstrap_values_preserve_frozen_membership_and_participant_weighting(
    inputs, bootstrap, bootstrap_values
):
    villages, priorities, _, scores = inputs
    values, gains, overall = bootstrap_values
    replicate = bootstrap.iloc[0]
    capacity = 13
    selected = set(priorities.loc[priorities["grf_eval_rank"].le(capacity), "village_id"])
    gamma = scores.groupby("village_id").agg(
        n=("ID", "size"), gamma_sum=("gamma_benefit", "sum")
    )
    denominator = sum(replicate.loc[village] * row.n for village, row in gamma.iterrows())
    numerator = sum(
        replicate.loc[village] * row.gamma_sum
        for village, row in gamma.iterrows()
        if village in selected
    )
    expected_overall = sum(
        replicate.loc[village] * row.gamma_sum for village, row in gamma.iterrows()
    ) / denominator

    assert set(values) == set(gains) == POLICIES
    assert all(value.shape == (2_000, 128) for value in values.values())
    assert np.isclose(values["grf"][0, capacity], numerator / denominator)
    assert np.isclose(overall[0], expected_overall)
    assert np.isclose(
        values["grf"][0, capacity] - gains["grf"][0, capacity],
        capacity / 127 * expected_overall,
    )
    changed = priorities.assign(
        mean_benefit_grf_oov=-priorities["mean_benefit_grf_oov"],
        gamma_benefit=np.arange(len(priorities)),
        W=np.arange(len(priorities)) % 2,
    )
    changed_values, _, _ = policy_uncertainty.bootstrap_policy_values(
        villages, changed, scores, bootstrap.iloc[:2]
    )
    np.testing.assert_allclose(changed_values["grf"], values["grf"][:2], rtol=0, atol=1e-12)


def test_bootstrap_structural_endpoints_hold_in_every_replicate(bootstrap_values):
    values, gains, overall = bootstrap_values

    for policy in POLICIES:
        assert np.array_equal(values[policy][:, 0], np.zeros(2_000))
        assert np.array_equal(gains[policy][:, 0], np.zeros(2_000))
        assert np.array_equal(values[policy][:, 127], overall)
        assert np.array_equal(gains[policy][:, 127], np.zeros(2_000))
    np.testing.assert_array_equal(values["grf"][:, 127], values["simple"][:, 127])
    np.testing.assert_array_equal(values["grf"][:, 127], values["baseline_risk"][:, 127])


def test_uncertainty_summaries_use_percentiles_and_common_paired_replicates(
    inputs, bootstrap_values
):
    _, _, curve, _ = inputs
    values, gains, _ = bootstrap_values
    uncertainty, anchors, pairwise, labels = policy_uncertainty.summarize_uncertainty(
        curve, values, gains
    )

    assert len(uncertainty) == 384
    assert not uncertainty.duplicated(["policy", "capacity_villages"]).any()
    assert len(anchors) == 15 and set(anchors["capacity_villages"]) == ANCHORS
    assert len(pairwise) == 12 and set(pairwise["capacity_villages"]) == NONFULL_ANCHORS
    assert len(labels) == 12 and set(labels["capacity_villages"]) == NONFULL_ANCHORS
    assert set(labels["capacity_advantage_label"]) <= {
        "ROBUST CAPACITY-SPECIFIC ADVANTAGE",
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE",
    }
    assert not any(
        token in column.lower()
        for table in (uncertainty, anchors, pairwise, labels)
        for column in table.columns
        for token in ("global_winner", "raw_rank", "equal_village", "equity", "influence")
    )

    grf_13 = uncertainty.query("policy == 'grf' and capacity_villages == 13").iloc[0]
    expected_value_ci = np.percentile(values["grf"][:, 13], [2.5, 97.5])
    expected_gain_ci = np.percentile(gains["grf"][:, 13], [2.5, 97.5])
    np.testing.assert_allclose(
        [grf_13["population_value_ci_lower"], grf_13["population_value_ci_upper"]],
        expected_value_ci,
    )
    np.testing.assert_allclose(
        [grf_13["gain_ci_lower"], grf_13["gain_ci_upper"]], expected_gain_ci
    )

    comparison = pairwise.query(
        "comparison == 'grf_minus_simple' and capacity_villages == 13"
    ).iloc[0]
    paired = values["grf"][:, 13] - values["simple"][:, 13]
    assert np.isclose(comparison["bootstrap_se"], paired.std(ddof=1))
    np.testing.assert_allclose(
        [comparison["ci_lower"], comparison["ci_upper"]],
        np.percentile(paired, [2.5, 97.5]),
    )
    assert uncertainty.query("capacity_villages == 0")[[
        "point_population_rollout_value", "population_value_ci_lower", "population_value_ci_upper",
        "point_gain_vs_random", "gain_ci_lower", "gain_ci_upper"
    ]].eq(0).all().all()
    assert uncertainty.query("capacity_villages == 127")[[
        "point_gain_vs_random", "gain_ci_lower", "gain_ci_upper"
    ]].eq(0).all().all()


def test_strict_capacity_advantage_requires_all_three_positive_intervals():
    assert policy_uncertainty.capacity_advantage_label(0.01, [0.02, 0.03]) == (
        "ROBUST CAPACITY-SPECIFIC ADVANTAGE"
    )
    assert policy_uncertainty.capacity_advantage_label(0.0, [0.02, 0.03]) == (
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    )
    assert policy_uncertainty.capacity_advantage_label(0.01, [0.02, -0.01]) == (
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    )


def test_pipeline_is_deterministic_preserves_upstream_and_stays_within_11a_scope():
    before = upstream_hashes()
    first = policy_uncertainty.run_phase11a_pipeline(ROOT)
    first_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in first.items()}
    second = policy_uncertainty.run_phase11a_pipeline(ROOT)
    second_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in second.items()}

    assert first_hashes == second_hashes
    assert upstream_hashes() == before
    assert set(first) == {
        "uncertainty_curve",
        "anchor_uncertainty",
        "pairwise_uncertainty",
        "advantage_labels",
        "bootstrap_metadata",
        "value_figure",
        "gain_figure",
    }
    assert not any(
        token in Path(path).name.lower()
        for path in first.values()
        for token in ("raw_rank", "equal_village", "equity", "influence", "global_winner", "participant")
    )
    metadata = pd.read_csv(first["bootstrap_metadata"]).iloc[0]
    assert metadata["bootstrap_replicates"] == 2_000
    assert metadata["bootstrap_seed"] == policy_uncertainty.BOOTSTRAP_SEED
    assert metadata["bootstrap_unit"] == "village"
    assert metadata["stratification"] == "randomized_treatment_arm_64_intervention_63_control"
    assert metadata["weighting"] == "participant_weighted_with_village_multiplicity"
    ignored_outputs = [path for path in first.values() if "data/derived" in Path(path).as_posix()]
    ignored = subprocess.run(
        ["git", "check-ignore", *ignored_outputs],
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
