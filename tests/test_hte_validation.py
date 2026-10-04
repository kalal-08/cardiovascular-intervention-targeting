from pathlib import Path

import numpy as np
import pandas as pd

from intervention_targeting import hte_crossfit, hte_validation


ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"


def phase7_inputs():
    return hte_validation.load_phase7_inputs(ROOT)


def test_phase7_inputs_remain_frozen_and_complete():
    matrix, oov = phase7_inputs()

    assert hte_crossfit.stable_frame_hash(
        pd.read_csv(DERIVED / "village_folds.csv")[["village_id", "fold"]],
        ["village_id"],
    ) == "9ea2d84d063aa3fb6d63b53b36b9c8ac9c7093a55679ca4c5def15d52676eb79"
    assert len(matrix) == len(oov) == 4_533
    assert matrix["outcome_observed"].sum() == oov["evaluation_eligible"].sum() == 4_508
    assert matrix["village_id"].nunique() == 127
    assert matrix.groupby("village_id")["fold"].nunique().eq(1).all()
    assert tuple(hte_crossfit.HTE_FEATURE_COLUMNS) == tuple(
        matrix.columns[-len(hte_crossfit.HTE_FEATURE_COLUMNS) :]
    )


def test_aipw_scores_are_out_of_village_and_match_locked_formula():
    matrix, _ = phase7_inputs()
    scores, audit = hte_validation.crossfit_aipw_scores(matrix)

    assert len(scores) == 4_508
    assert scores["ID"].is_unique
    assert scores["village_id"].nunique() == 127
    assert scores[["gamma_tau", "gamma_benefit", "m1_hat", "m0_hat"]].apply(
        np.isfinite
    ).all().all()
    assert audit["village_overlap"].eq(0).all()
    assert audit["propensity"].eq(0.5).all()
    assert audit["feature_count"].eq(22).all()

    row = scores.iloc[0]
    expected = (
        row.m1_hat
        - row.m0_hat
        + row.W / 0.5 * (row.delta_risk - row.m1_hat)
        - (1 - row.W) / 0.5 * (row.delta_risk - row.m0_hat)
    )
    assert row.gamma_tau == expected
    np.testing.assert_array_equal(scores["gamma_benefit"], -scores["gamma_tau"])

    contaminated = matrix.assign(
        benefit_hat_grf=np.arange(len(matrix)),
        benefit_hat_simple_oov=-np.arange(len(matrix)),
    )
    second, _ = hte_validation.crossfit_aipw_scores(contaminated)
    pd.testing.assert_series_equal(scores["gamma_tau"], second["gamma_tau"])


def test_priorities_preserve_raw_predictions_and_are_deterministic():
    matrix, oov = phase7_inputs()
    scores, _ = hte_validation.crossfit_aipw_scores(matrix)
    ranked = hte_validation.build_priority_frame(scores, oov)
    repeated = hte_validation.build_priority_frame(scores, oov)

    assert len(ranked) == 4_508
    assert ranked["ID"].is_unique
    pd.testing.assert_series_equal(ranked["random_priority_raw"], repeated["random_priority_raw"])
    for rule in ("grf", "simple", "risk", "random"):
        priority = ranked[f"priority_{rule}_within_fold"]
        assert priority.between(0, 1, inclusive="right").all()
        assert ranked.groupby("fold")[f"priority_{rule}_within_fold"].nunique().gt(1).all()

    source = oov.set_index("ID")
    aligned = ranked.set_index("ID")
    np.testing.assert_array_equal(aligned["benefit_hat_grf"], source.loc[aligned.index, "benefit_hat_grf"])
    np.testing.assert_array_equal(
        aligned["benefit_hat_simple_oov"], source.loc[aligned.index, "benefit_hat_simple_oov"]
    )
    np.testing.assert_array_equal(aligned["risk0"], source.loc[aligned.index, "risk0"])


def test_clustered_calibration_quintiles_and_ranking_outputs_cover_required_rules():
    matrix, oov = phase7_inputs()
    scores, _ = hte_validation.crossfit_aipw_scores(matrix)
    ranked = hte_validation.build_priority_frame(scores, oov)

    mean = hte_validation.clustered_mean_summary(ranked, "gamma_benefit")
    calibration = hte_validation.calibration_summary(ranked)
    quintiles = hte_validation.quintile_summary(ranked)
    correlations, fold_diagnostics = hte_validation.ranking_stability(ranked)

    assert mean["clusters"] == 127
    assert np.isfinite([mean["estimate"], mean["std_error"]]).all()
    assert set(calibration["model"]) == {"grf", "simple"}
    assert calibration["clusters"].eq(127).all()
    assert set(calibration["interpretation"]) <= {
        "positive alignment",
        "inconclusive alignment",
        "negative alignment",
    }
    assert set(quintiles["quintile"]) == {1, 2, 3, 4, 5}
    assert quintiles["participant_count"].sum() == 4_508
    assert set(correlations["comparison"]) == {
        "grf_vs_simple",
        "grf_vs_baseline_risk",
        "simple_vs_baseline_risk",
    }
    assert set(fold_diagnostics["rule"]) == {"grf", "simple", "baseline_risk", "random"}
    assert set(fold_diagnostics["fold"]) == {1, 2, 3, 4, 5}


def test_predeclared_evidence_labels_require_uncertainty_excluding_zero():
    rate = pd.DataFrame(
        [
            {"rule": "grf", "normalization": "within_fold", "target": "AUTOC", "estimate": 0.6, "ci_low": 0.1, "ci_high": 1.1},
            {"rule": "grf", "normalization": "within_fold", "target": "QINI", "estimate": 0.2, "ci_low": 0.02, "ci_high": 0.4},
            {"rule": "grf", "normalization": "raw", "target": "AUTOC", "estimate": 0.5, "ci_low": -0.1, "ci_high": 1.1},
        ]
    )
    paired = pd.DataFrame(
        [
            {"comparison": "grf_minus_simple", "ci_low": -0.2},
            {"comparison": "grf_minus_baseline_risk", "ci_low": 0.01},
        ]
    )
    calibration = pd.DataFrame(
        [{"model": "grf", "slope": 0.9, "ci_low": 0.1, "ci_high": 1.7}]
    )

    labels = hte_validation._classifications(rate, paired, calibration)

    assert labels == {
        "grf_hte_validation": "SUPPORTED",
        "incremental_grf_vs_simple": "NOT DEMONSTRATED",
        "grf_vs_baseline_risk": "SUPPORTED",
    }
