from pathlib import Path

import numpy as np
import pandas as pd

from intervention_targeting.cohort import FOLLOWUP_COLUMNS, build_causal_cohort
from intervention_targeting import intervention_effects


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"
REPRODUCTION = ROOT / "data" / "derived" / "trial_reproduction.csv"

EXPECTED_CONTINUOUS = {"age", "risk0", "SBP0", "DBP0", "GLU0", "NHDL0"}
EXPECTED_DESIGN = {"vc_age_grp", "vc_sbp_grp", "vc_risk_grp", "doctor_college_above"}
EXPECTED_BINARY = {
    "male",
    "education_high_above",
    "occupation_farmer",
    "Last_year_income_lt_10k",
    "marriage_yes",
    "insure_yes",
    "smk_daily_0",
    "PA_lt3000_0",
    "vc_age_grp",
    "vc_sbp_grp",
    "vc_risk_grp",
    "doctor_college_above",
}
EXPECTED_SECONDARY = {
    "SBP": ("SBP0", "SBP4", "mm Hg"),
    "DBP": ("DBP0", "DBP4", "mm Hg"),
    "GLU": ("GLU0", "GLU4", "mmol/L"),
    "NHDL": ("NHDL0", "NHDL4", "mmol/L"),
}


def cohort():
    return build_causal_cohort(RAW)


def test_smd_calculations_match_deterministic_toy_examples():
    treated_continuous = pd.Series([2.0, 4.0])
    control_continuous = pd.Series([0.0, 2.0])
    treated_binary = pd.Series([1, 1, 0, 0])
    control_binary = pd.Series([0, 0, 0, 0])

    assert np.isclose(
        intervention_effects.standardized_mean_difference(
            treated_continuous, control_continuous, "continuous"
        ),
        np.sqrt(2),
    )
    assert np.isclose(
        intervention_effects.standardized_mean_difference(treated_binary, control_binary, "binary"),
        np.sqrt(2),
    )


def test_baseline_balance_is_pretreatment_only_and_preserves_randomization():
    data = cohort()
    balance = intervention_effects.baseline_balance(data)

    assert set(intervention_effects.CONTINUOUS_BALANCE_VARIABLES) == EXPECTED_CONTINUOUS
    assert set(intervention_effects.BINARY_BALANCE_VARIABLES) == EXPECTED_BINARY
    assert not (set(FOLLOWUP_COLUMNS) & set(balance["variable"]))
    assert not any(name.endswith("4") or name.endswith("_4") for name in balance["variable"])
    assert balance["control_n"].eq(2_236).all()
    assert balance["intervention_n"].eq(2_297).all()
    assert data.groupby("W")["village_id"].nunique().to_dict() == {0: 63, 1: 64}
    assert "p_value" not in balance.columns
    assert np.allclose(balance["abs_smd"], balance["smd"].abs())


def test_cluster_context_uses_villages_without_exposing_village_ids():
    context = intervention_effects.cluster_balance_context(cohort())

    assert set(context["variable"]) == {
        "age",
        "risk0",
        "SBP0",
        "vc_age_grp",
        "vc_sbp_grp",
        "vc_risk_grp",
        "doctor_college_above",
    }
    assert set(context.loc[context["variable"].isin(EXPECTED_DESIGN), "summary_type"]) == {
        "level_1_proportion"
    }
    assert context.groupby("W")["villages"].first().to_dict() == {0: 63, 1: 64}
    assert "village_id" not in context.columns
    assert len(context) == 14


def test_primary_risk_summary_preserves_fields_sign_and_missingness():
    data = cohort()
    summary = intervention_effects.primary_risk_summary(data)

    assert set(summary["measure"]) == {"risk0", "risk4", "delta_risk"}
    assert set(summary["arm"]) == {"Overall", "Control", "Intervention"}
    assert summary.query("arm == 'Overall' and measure == 'risk0'")["missing"].item() == 0
    assert summary.query("arm == 'Overall' and measure == 'risk4'")["missing"].item() == 25
    assert summary.query("arm == 'Overall' and measure == 'delta_risk'")["missing"].item() == 25
    observed = data["delta_risk"].notna()
    np.testing.assert_allclose(
        data.loc[observed, "delta_risk"], data.loc[observed, "risk4"] - data.loc[observed, "risk0"]
    )


def test_phase5_reuses_canonical_phase4_result_without_refitting():
    result = intervention_effects.read_canonical_primary_effect(REPRODUCTION)

    assert result["estimate"] == -1.8799816659919089
    assert result["ci_lower"] == -2.564212452967485
    assert result["ci_upper"] == -1.1957508790163325
    assert result["analysis_n"] == 4_508
    assert result["villages"] == 127
    assert result["reproduction_status"] == "REPRODUCED"
    assert result["contrast"] == "intervention_minus_control"


def test_secondary_outcomes_use_explicit_change_and_cluster_contracts():
    data = cohort()

    assert intervention_effects.SECONDARY_OUTCOMES == EXPECTED_SECONDARY
    for outcome, (baseline, followup, _) in EXPECTED_SECONDARY.items():
        frame = intervention_effects.build_secondary_model_frame(data, outcome)
        change = f"{outcome}_change"
        assert len(frame) == 4_508
        assert frame["village_id"].nunique() == 127
        assert frame[followup].notna().all()
        np.testing.assert_allclose(frame[change], frame[followup] - frame[baseline])
        assert frame.groupby("village_id")["W"].nunique().eq(1).all()


def test_secondary_mixed_models_return_finite_complete_results():
    data = cohort()
    results = intervention_effects.estimate_secondary_effects(data)

    assert results["outcome"].tolist() == ["SBP", "DBP", "GLU", "NHDL"]
    assert results["analysis_n"].eq(4_508).all()
    assert results["villages"].eq(127).all()
    assert results["converged"].all()
    assert np.isfinite(results[["estimate", "std_error", "ci_lower", "ci_upper", "p_value"]]).all().all()
    assert (results["ci_lower"] < results["ci_upper"]).all()


def test_effect_and_change_summaries_are_complete_and_keep_primary_canonical():
    data = cohort()
    primary = intervention_effects.read_canonical_primary_effect(REPRODUCTION)
    secondary = intervention_effects.estimate_secondary_effects(data)
    effects = intervention_effects.intervention_effect_summary(primary, secondary)
    changes = intervention_effects.outcome_change_summary(data)

    assert effects["outcome"].tolist() == ["ASCVD risk", "SBP", "DBP", "GLU", "NHDL"]
    assert effects.iloc[0]["classification"] == "Primary"
    assert effects.iloc[0]["estimate"] == -1.8799816659919089
    assert effects.iloc[0]["source"] == "canonical Phase-4 reproduction"
    assert effects.iloc[1:]["classification"].eq("Secondary/contextual").all()
    assert len(changes) == 10
    assert set(changes["arm"]) == {"Control", "Intervention"}
    assert set(changes["outcome"]) == {"ASCVD risk", "SBP", "DBP", "GLU", "NHDL"}
    assert changes["analysis_n"].isin({2_224, 2_284}).all()


def test_aggregate_outputs_and_figures_are_safe_and_deterministic(tmp_path):
    data = cohort()
    balance = intervention_effects.baseline_balance(data)
    risk = intervention_effects.primary_risk_summary(data)
    tables = {"baseline_balance": balance, "outcome_change_summary": risk}

    intervention_effects.write_aggregate_tables(tables, tmp_path)
    for name, expected in tables.items():
        saved = pd.read_csv(tmp_path / f"{name}.csv")
        pd.testing.assert_frame_equal(saved, expected, check_dtype=False)
        assert "ID" not in saved.columns
        assert "village_id" not in saved.columns
        assert len(saved) < 4_533

    balance_plot = tmp_path / "baseline_balance.png"
    risk_plot = tmp_path / "primary_risk_change.png"
    intervention_effects.plot_baseline_balance(balance, balance_plot)
    intervention_effects.plot_primary_risk_distributions(data, risk_plot)
    first_hashes = (balance_plot.read_bytes(), risk_plot.read_bytes())
    intervention_effects.plot_baseline_balance(balance, balance_plot)
    intervention_effects.plot_primary_risk_distributions(data, risk_plot)
    assert first_hashes == (balance_plot.read_bytes(), risk_plot.read_bytes())
    assert balance_plot.read_bytes().startswith(b"\x89PNG")
    assert risk_plot.read_bytes().startswith(b"\x89PNG")

    forbidden = {"true_benefit", "oracle_benefit", "cate", "rank", "priority"}
    assert not forbidden & {column.lower() for table in tables.values() for column in table.columns}
