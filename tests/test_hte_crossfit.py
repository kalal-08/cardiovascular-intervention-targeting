from pathlib import Path
import subprocess

import numpy as np
import pandas as pd
import pytest

from intervention_targeting.cohort import (
    FOLLOWUP_COLUMNS,
    HTE_FEATURE_DENYLIST,
    build_causal_cohort,
)
from intervention_targeting import hte_crossfit


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"

EXPECTED_FEATURES = (
    "age",
    "male",
    "education_high_above",
    "occupation_farmer",
    "Last_year_income_lt_10k",
    "marriage_yes",
    "insure_yes",
    "BMI0_grp",
    "waist0_normal",
    "risk0",
    "SBP0",
    "DBP0",
    "GLU0",
    "NHDL0",
    "obesity_0",
    "smk_daily_0",
    "PA_lt3000_0",
    "LTPA0",
    "vc_age_grp",
    "vc_sbp_grp",
    "vc_risk_grp",
    "doctor_college_above",
)


@pytest.fixture(scope="module")
def cohort():
    return build_causal_cohort(RAW)


@pytest.fixture(scope="module")
def folds(cohort):
    return hte_crossfit.build_village_folds(cohort)


@pytest.fixture(scope="module")
def matrix(cohort, folds):
    return hte_crossfit.build_model_matrix(cohort, folds)


def test_frozen_x_is_complete_numeric_and_leakage_safe(cohort):
    assert hte_crossfit.HTE_FEATURE_COLUMNS == EXPECTED_FEATURES
    assert "risk_lifetime_0" not in hte_crossfit.HTE_FEATURE_COLUMNS
    forbidden = set(HTE_FEATURE_DENYLIST) | set(FOLLOWUP_COLUMNS)
    assert not forbidden & set(hte_crossfit.HTE_FEATURE_COLUMNS)
    assert not {"ID", "village_id", "group", "W", "risk4", "delta_risk"} & set(
        hte_crossfit.HTE_FEATURE_COLUMNS
    )
    assert not any(name.endswith("4") or name.endswith("_4") for name in EXPECTED_FEATURES)
    assert cohort[list(EXPECTED_FEATURES)].notna().all().all()
    assert all(pd.api.types.is_numeric_dtype(cohort[name]) for name in EXPECTED_FEATURES)

    manifest = hte_crossfit.build_feature_manifest()
    assert manifest["feature"].tolist() == list(EXPECTED_FEATURES)
    assert manifest["included_in_grf"].eq(1).all()


def test_fold_map_is_deterministic_outcome_blind_and_village_intact(cohort, folds):
    changed_outcomes = cohort.copy()
    changed_outcomes["risk4"] = np.nan
    changed_outcomes["delta_risk"] = np.nan
    changed_outcomes["primary_outcome_observed"] = False
    second = hte_crossfit.build_village_folds(changed_outcomes)

    pd.testing.assert_series_equal(
        folds.set_index("village_id")["fold"],
        second.set_index("village_id")["fold"],
    )
    assert len(folds) == 127
    assert folds["village_id"].is_unique
    assert set(folds["fold"]) == {1, 2, 3, 4, 5}
    assert folds.groupby("fold")["W"].nunique().eq(2).all()
    assert folds.groupby("fold")["village_id"].size().between(25, 26).all()
    inherited = cohort[["ID", "village_id"]].merge(folds[["village_id", "fold"]], on="village_id")
    assert inherited.groupby("village_id")["fold"].nunique().eq(1).all()
    hte_crossfit.validate_village_folds(cohort, folds)


def test_model_matrix_preserves_prediction_and_training_populations(matrix):
    assert len(matrix) == 4_533
    assert matrix["ID"].is_unique
    assert matrix["village_id"].nunique() == 127
    assert matrix["outcome_observed"].dtype == "int8"
    assert set(matrix["outcome_observed"]) == {0, 1}
    assert matrix["outcome_observed"].sum() == 4_508
    observed = matrix["outcome_observed"].eq(1)
    assert matrix.loc[observed, "delta_risk"].notna().all()
    assert matrix.loc[~observed, "delta_risk"].isna().all()
    assert matrix[list(EXPECTED_FEATURES)].notna().all().all()
    assert matrix.groupby("village_id")["fold"].nunique().eq(1).all()


def test_simple_benchmark_uses_same_folds_and_excludes_heldout_villages(cohort, folds):
    predictions, audit = hte_crossfit.crossfit_simple_benchmark(cohort, folds)

    assert len(predictions) == 4_533
    assert predictions["ID"].is_unique
    assert predictions["tau_hat_simple_oov"].notna().all()
    np.testing.assert_allclose(
        predictions["benefit_hat_simple_oov"], -predictions["tau_hat_simple_oov"]
    )
    assert audit["training_villages"].between(101, 102).all()
    assert audit["heldout_villages"].between(25, 26).all()
    assert audit["village_overlap"].eq(0).all()
    assert audit["training_rows"].lt(4_508).all()
    assert audit["heldout_prediction_rows"].sum() == 4_533
    assert predictions[["village_id", "fold"]].drop_duplicates().merge(
        folds[["village_id", "fold"]], on=["village_id", "fold"]
    ).shape[0] == 127


def test_grf_output_validation_joins_by_keys_not_row_order(matrix):
    grf = matrix[["ID", "village_id", "fold"]].copy()
    grf["model_fold"] = grf["fold"]
    grf["tau_hat_grf"] = np.linspace(-3.0, -1.0, len(grf))
    grf["benefit_hat_grf"] = -grf["tau_hat_grf"]
    grf["training_village_count"] = grf["fold"].map(
        matrix.groupby("fold")["village_id"].nunique().rsub(127)
    )

    validated = hte_crossfit.validate_grf_predictions(matrix, grf.sample(frac=1, random_state=7))
    assert validated["ID"].tolist() == matrix["ID"].tolist()
    np.testing.assert_allclose(validated["benefit_hat_grf"], -validated["tau_hat_grf"])
    with pytest.raises(ValueError, match="duplicate"):
        hte_crossfit.validate_grf_predictions(matrix, pd.concat([grf, grf.iloc[[0]]]))


def test_merged_oov_contract_has_full_coverage_and_no_early_evaluation(cohort, folds, matrix):
    simple, _ = hte_crossfit.crossfit_simple_benchmark(cohort, folds)
    grf = matrix[["ID", "village_id", "fold"]].copy()
    grf["model_fold"] = grf["fold"]
    grf["tau_hat_grf"] = -1.0
    grf["benefit_hat_grf"] = 1.0
    grf["training_village_count"] = grf["fold"].map(
        matrix.groupby("fold")["village_id"].nunique().rsub(127)
    )
    merged = hte_crossfit.merge_oov_predictions(matrix, simple, grf)

    assert len(merged) == 4_533
    assert merged["ID"].is_unique
    assert merged["prediction_eligible"].eq(1).all()
    assert merged["evaluation_eligible"].sum() == 4_508
    assert merged[["tau_hat_simple_oov", "benefit_hat_simple_oov", "tau_hat_grf", "benefit_hat_grf"]].notna().all().all()
    assert not {"rank", "priority", "policy", "winner", "selected"} & {
        column.lower() for column in merged.columns
    }


def test_internal_phase7_artifacts_are_gitignored():
    result = subprocess.run(
        ["git", "check-ignore", "data/derived/hte_model_matrix.csv"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
