from hashlib import sha256
import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest


ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
BI = ROOT / "powerbi"
BI_DATA = BI / "data"
POLICIES = {"grf", "simple", "baseline_risk"}
ANCHORS = {13, 32, 64, 95, 127}
FINAL_CONCLUSION = "NO SINGLE ROBUST POLICY WINNER ESTABLISHED"
RAW_SHA256 = "2a42364e388ed21ae9b4dc0038424c3e4e4ffb60e9aebd8edef7db8d356b7741"
UPSTREAM = (
    "hte_oov_predictions.csv",
    "hte_validation_summary.csv",
    "calibration_summary.csv",
    "village_benefit_summary.csv",
    "policy_village_priorities.csv",
    "policy_capacity_curve.csv",
    "policy_uncertainty_curve.csv",
    "anchor_policy_uncertainty.csv",
    "capacity_advantage_labels.csv",
    "final_policy_robustness_summary.csv",
    "equity_coverage_summary.csv",
    "final_phase11_conclusion.csv",
)


def hashes(paths):
    return {path.name: sha256(path.read_bytes()).hexdigest() for path in paths}


def load_module():
    try:
        from intervention_targeting import powerbi_inputs
    except ImportError:
        pytest.fail("Phase-12A powerbi_inputs module is missing")
    return powerbi_inputs


def test_phase12a_module_exists():
    assert importlib.util.find_spec("intervention_targeting.powerbi_inputs") is not None


@pytest.fixture(scope="module")
def module():
    return load_module()


@pytest.fixture(scope="module")
def tables(module):
    return module.build_powerbi_tables(ROOT)


def test_study_effect_and_hte_values_reconcile_exactly(module, tables):
    intervention = tables["bi_intervention_summary"]
    assert len(intervention) == 1
    row = intervention.iloc[0]
    assert row["randomized_participants"] == 4_533
    assert row["evaluation_participants"] == 4_508
    assert row["missing_primary_outcome"] == 25
    assert row["villages"] == 127
    assert row["intervention_participants"] == 2_297
    assert row["control_participants"] == 2_236
    assert row["intervention_villages"] == 64
    assert row["control_villages"] == 63

    upstream_effect = pd.read_csv(DERIVED / "trial_reproduction.csv").iloc[0]
    for field in ("estimate", "std_error", "ci_lower", "ci_upper"):
        assert row[f"treatment_effect_{field}"] == upstream_effect[field]

    hte = tables["bi_hte_validation"]
    upstream_hte = pd.read_csv(DERIVED / "hte_validation_summary.csv")
    primary = upstream_hte[upstream_hte["normalization"].eq("within_fold")]
    for rule in ("grf", "simple", "baseline_risk", "random"):
        expected = primary[(primary["rule"].eq(rule)) & (primary["target"].eq("AUTOC"))].iloc[0]
        actual = hte[(hte["metric"].eq("AUTOC")) & (hte["model_or_comparison"].eq(rule))].iloc[0]
        assert actual["estimate"] == expected["estimate"]


def test_bi_tables_have_documented_unique_aggregate_grains(module, tables):
    assert set(tables) == set(module.TABLE_SPECS)
    for name, frame in tables.items():
        keys = module.TABLE_SPECS[name]["keys"]
        assert len(frame) == module.TABLE_SPECS[name]["rows"]
        assert not frame.duplicated(keys).any(), name
        assert not frame.columns.duplicated().any(), name

    village = tables["bi_village_priority"]
    assert len(village) == village["village_id"].nunique() == 127
    assert {"grf_candidate_rank", "simple_candidate_rank", "baseline_risk_candidate_rank"} <= set(village)
    assert not {"fold", "W", "mean_gamma_tau", "mean_gamma_benefit"} & set(village)


def test_no_participant_or_unsupported_decision_fields_enter_bi(tables):
    forbidden_exact = {"ID", "participant_id", "risk4", "delta_risk", "W"}
    forbidden_fragments = ("optimal", "recommended", "winner_rank", "final_rank", "fund_flag", "fairness_score", "bias_score", "parity_threshold")
    for name, frame in tables.items():
        assert not forbidden_exact & set(frame), name
        assert not any(fragment in column.lower() for column in frame for fragment in forbidden_fragments), name
    assert len(tables["bi_equity_coverage"]) == 150
    assert set(tables["bi_equity_coverage"]["scientific_category"]) == {"descriptive"}
    assert set(tables["dim_policy"].set_index("policy")["scientific_category"].to_dict().items()) == {
        ("grf", "predictive_causal_hte"),
        ("simple", "predictive_causal_hte"),
        ("baseline_risk", "heuristic"),
    }


def test_rollout_capacity_anchor_and_uncertainty_are_frozen(module, tables):
    curve = tables["bi_rollout_capacity"]
    anchor = tables["bi_rollout_anchor"]
    assert len(curve) == 3 * 128
    assert set(curve["policy"]) == POLICIES
    assert set(curve["capacity_villages"]) == set(range(128))
    assert set(anchor["capacity_villages"]) == ANCHORS
    assert len(anchor) == 15

    source = pd.read_csv(DERIVED / "anchor_policy_uncertainty.csv").sort_values(["policy", "capacity_villages"])
    actual = anchor.sort_values(["policy", "capacity_villages"])
    for field in (
        "point_population_rollout_value",
        "population_value_ci_lower",
        "population_value_ci_upper",
        "point_random_expected_value",
        "point_gain_vs_random",
        "gain_ci_lower",
        "gain_ci_upper",
    ):
        assert np.array_equal(actual[field].to_numpy(), source[field].to_numpy())
    full = anchor[anchor["capacity_villages"].eq(127)]
    assert np.allclose(full["point_population_rollout_value"], module.OVERALL_GAMMA_BENEFIT, rtol=0, atol=1e-15)
    assert np.allclose(full["point_gain_vs_random"], 0, atol=1e-15)
    assert set(anchor[anchor["capacity_villages"].lt(127)]["capacity_advantage_label"]) == {
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    }


def test_robustness_equity_and_final_conclusion_remain_locked(tables):
    robust = tables["bi_policy_robustness"]
    assert len(robust) == 12
    assert set(robust["phase11a_capacity_advantage_label"]) == {
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    }
    assert set(robust["phase11a_gain_classification"]) == {"INCONCLUSIVE"}
    assert set(robust["raw_ranking_stability"]) == {"SENSITIVE"}
    assert set(robust["equal_village_consistency"]) == {"CONSISTENT"}
    assert tables["bi_intervention_summary"].iloc[0]["final_policy_conclusion"] == FINAL_CONCLUSION

    equity = tables["bi_equity_coverage"]
    assert set(equity["dimension"]) == {"age", "sex", "education", "occupation", "income"}
    assert set(equity["analysis_note"]) == {
        "Coverage comparisons are descriptive and are not fairness-optimization criteria."
    }


def test_dictionary_relationships_and_power_query_types(module, tables):
    dictionary = module.build_data_dictionary(tables)
    assert set(dictionary["table_name"]) == set(tables)
    assert not dictionary.duplicated(["table_name", "column_name"]).any()
    assert set(dictionary["power_query_type"]) <= {"Text", "Whole Number", "Decimal Number", "True/False"}
    assert dictionary["grain"].notna().all()
    assert dictionary["allowed_joins"].notna().all()
    assert dictionary["metric_unit"].notna().all()
    assert dictionary["scientific_category"].notna().all()
    assert set(module.RELATIONSHIPS) == {
        ("dim_policy", "policy", "bi_rollout_capacity", "policy", "1:*", "single"),
        ("dim_policy", "policy", "bi_rollout_anchor", "policy", "1:*", "single"),
        ("dim_policy", "policy", "bi_policy_robustness", "policy", "1:*", "single"),
        ("dim_policy", "policy", "bi_equity_coverage", "policy", "1:*", "single"),
        ("dim_capacity", "capacity_villages", "bi_rollout_capacity", "capacity_villages", "1:*", "single"),
        ("dim_capacity", "capacity_villages", "bi_rollout_anchor", "capacity_villages", "1:*", "single"),
        ("dim_capacity", "capacity_villages", "bi_policy_robustness", "capacity_villages", "1:*", "single"),
        ("dim_capacity", "capacity_villages", "bi_policy_overlap", "capacity_villages", "1:*", "single"),
        ("dim_capacity", "capacity_villages", "bi_equity_coverage", "capacity_villages", "1:*", "single"),
    }


def test_machine_readable_reconciliation_targets_cover_exact_anchor_values(module, tables):
    targets = module.build_reconciliation_targets(tables)
    assert not targets["target_id"].duplicated().any()
    assert {"study", "average_effect", "hte", "rollout_anchor", "final_conclusion"} <= set(targets["target_group"])
    anchor = targets[targets["target_group"].eq("rollout_anchor")]
    assert set(anchor["policy"].dropna()) == POLICIES
    assert set(anchor["capacity_villages"].dropna().astype(int)) == ANCHORS
    assert len(anchor) == 15 * 8
    assert (targets["source_artifact"].str.startswith("data/derived/")).all()
    assert targets["expected_numeric"].notna().sum() > 0
    assert FINAL_CONCLUSION in set(targets["expected_text"].dropna())


def test_generated_contract_is_deterministic_and_preserves_upstream(module, tmp_path):
    before = hashes(DERIVED / name for name in UPSTREAM)
    first = tmp_path / "first"
    second = tmp_path / "second"
    module.write_powerbi_inputs(ROOT, first)
    module.write_powerbi_inputs(ROOT, second)
    assert hashes(first.rglob("*.csv")) == hashes(second.rglob("*.csv"))
    assert before == hashes(DERIVED / name for name in UPSTREAM)
    assert sha256((ROOT / "data/raw/smarter_anonymised_data.csv").read_bytes()).hexdigest() == RAW_SHA256


@pytest.mark.local_only
def test_documented_dax_power_query_and_five_page_contracts_are_safe():
    dax = (BI / "dax_measures.md").read_text(encoding="utf-8")
    dashboard = (BI / "dashboard_spec.md").read_text(encoding="utf-8")
    readme = (BI / "README.md").read_text(encoding="utf-8")
    assert dashboard.count("## Page ") == 5
    assert FINAL_CONCLUSION in dashboard
    assert "SUPPORTED" in dashboard and "NOT DEMONSTRATED" in dashboard
    assert "Coverage comparisons are descriptive and are not fairness-optimization criteria." in dashboard
    assert "many-to-many" in readme and "Power Query" in readme
    assert "Power Query must not" in readme
    forbidden_dax = ("SUMX(", "AVERAGEX(", "RANKX(", "LINESTX(", "PERCENTILEX(")
    assert not any(token in dax.upper() for token in forbidden_dax)
    assert "must not estimate" in dax.lower()
