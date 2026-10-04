from pathlib import Path

import numpy as np
import pandas as pd

from intervention_targeting.cohort import build_causal_cohort
from intervention_targeting import trial_effects


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"

EXPECTED_FIXED_EFFECTS = {
    "W",
    "risk0",
    "age",
    "male",
    "education_high_above",
    "Last_year_income_lt_10k",
    "occupation_farmer",
    "marriage_yes",
    "insure_yes",
    "vc_risk_grp",
    "vc_sbp_grp",
    "vc_age_grp",
    "doctor_college_above",
}

EXPECTED_CATEGORICAL_EFFECTS = {
    "male",
    "education_high_above",
    "Last_year_income_lt_10k",
    "occupation_farmer",
    "marriage_yes",
    "insure_yes",
    "vc_risk_grp",
    "vc_sbp_grp",
    "vc_age_grp",
    "doctor_college_above",
}


def causal_cohort():
    return build_causal_cohort(RAW)


def test_primary_model_frame_preserves_trial_and_outcome_contracts():
    frame = trial_effects.build_primary_model_frame(causal_cohort())

    assert len(frame) == 4_508
    assert frame["village_id"].nunique() == 127
    assert frame["delta_risk"].notna().all()
    assert frame["primary_outcome_observed"].all()
    assert frame["W"].value_counts().to_dict() == {1: 2_284, 0: 2_224}
    assert frame.groupby("W")["village_id"].nunique().to_dict() == {0: 63, 1: 64}
    assert (frame["W"] == frame["group"].map({1: 1, 2: 0})).all()
    assert frame.groupby("village_id")["W"].nunique().eq(1).all()
    np.testing.assert_allclose(frame["delta_risk"], frame["risk4"] - frame["risk0"])


def test_primary_specification_uses_only_official_baseline_and_design_terms():
    assert set(trial_effects.FIXED_EFFECTS) == EXPECTED_FIXED_EFFECTS
    assert set(trial_effects.CATEGORICAL_EFFECTS) == EXPECTED_CATEGORICAL_EFFECTS
    assert trial_effects.OUTCOME == "delta_risk"
    assert trial_effects.GROUP_COLUMN == "village_id"
    assert "ID" not in trial_effects.FIXED_EFFECTS
    assert "village_id" not in trial_effects.FIXED_EFFECTS
    assert not any(name.endswith("4") or name.endswith("_4") for name in trial_effects.FIXED_EFFECTS)


def test_arm_descriptives_are_bounded_and_complete():
    summary = trial_effects.describe_by_arm(trial_effects.build_primary_model_frame(causal_cohort()))

    assert summary["W"].tolist() == [0, 1]
    assert summary["n"].tolist() == [2_224, 2_284]
    assert summary["villages"].tolist() == [63, 64]
    assert summary[["mean_risk0", "mean_risk4", "mean_delta_risk", "sd_delta_risk"]].notna().all().all()


def test_reproduction_gate_uses_locked_point_difference_and_inference_rules():
    passing = trial_effects.compare_with_publication(-1.90, -2.55, -1.25)
    outside_tolerance = trial_effects.compare_with_publication(-1.50, -2.20, -0.80)
    wrong_direction = trial_effects.compare_with_publication(1.88, 1.19, 2.57)

    assert np.isclose(passing["absolute_estimate_difference"], 0.02)
    assert passing["reproduction_status"] == "REPRODUCED"
    assert outside_tolerance["reproduction_status"] == "NOT REPRODUCED — BLOCKER"
    assert wrong_direction["reproduction_status"] == "NOT REPRODUCED — BLOCKER"


def test_primary_mixed_model_is_finite_converged_and_deterministic():
    frame = trial_effects.build_primary_model_frame(causal_cohort())
    first = trial_effects.fit_primary_model(frame)
    second = trial_effects.fit_primary_model(frame)
    result = trial_effects.summarize_primary_result(first, frame)
    comparison = trial_effects.compare_with_publication(
        result["estimate"], result["ci_lower"], result["ci_upper"]
    )

    assert first.converged
    assert second.converged
    assert np.isfinite(result["estimate"])
    assert np.isfinite(result["std_error"])
    assert np.isfinite(result["ci_lower"])
    assert np.isfinite(result["ci_upper"])
    assert result["ci_lower"] < result["estimate"] < result["ci_upper"]
    assert result["estimate"] < 0
    assert result["analysis_n"] == 4_508
    assert result["villages"] == 127
    assert comparison["reproduction_status"] != "NOT REPRODUCED — BLOCKER"
    assert np.isclose(first.params["W"], second.params["W"], rtol=0, atol=1e-8)


def test_aggregate_result_writer_exposes_no_participant_data(tmp_path):
    result = {
        "model": "primary_adjusted_mixed_model",
        "analysis_n": 4_508,
        "villages": 127,
        "estimate": -1.9,
        "std_error": 0.35,
        "ci_lower": -2.59,
        "ci_upper": -1.21,
        "p_value": 0.001,
        "published_estimate": -1.88,
        "published_ci_lower": -2.57,
        "published_ci_upper": -1.19,
        "absolute_estimate_difference": 0.02,
        "reproduction_status": "REPRODUCED",
    }
    output = tmp_path / "trial_reproduction.csv"

    trial_effects.write_aggregate_result(result, output)
    saved = pd.read_csv(output)

    assert len(saved) == 1
    assert set(saved.columns) == set(result)
    assert "ID" not in saved.columns
    assert "village_id" not in saved.columns
