from hashlib import sha256
from pathlib import Path
import subprocess

import numpy as np
import pandas as pd

from intervention_targeting import village_aggregation


ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
UPSTREAM = (
    "village_folds.csv",
    "grf_oov_predictions.csv",
    "simple_hte_oov_predictions.csv",
    "hte_oov_predictions.csv",
    "hte_evaluation_scores.csv",
    "hte_nuisance_audit.csv",
    "hte_validation_input.csv",
    "hte_validation_summary.csv",
    "paired_rate_comparisons.csv",
    "toc_curve.csv",
    "calibration_summary.csv",
    "hte_quintile_diagnostic.csv",
    "ranking_stability.csv",
    "fold_priority_diagnostics.csv",
    "aipw_overall_summary.csv",
    "hte_evidence_classification.csv",
)


def upstream_hashes():
    return {name: sha256((DERIVED / name).read_bytes()).hexdigest() for name in UPSTREAM}


def phase9_inputs():
    return village_aggregation.load_phase9_inputs(ROOT)


def test_phase9_inputs_reconcile_frozen_prediction_and_evaluation_populations():
    predictions, scores = phase9_inputs()

    assert len(predictions) == 4_533
    assert predictions["ID"].is_unique
    assert predictions["village_id"].nunique() == 127
    assert predictions["evaluation_eligible"].sum() == 4_508
    assert predictions.groupby("village_id")["fold"].nunique().eq(1).all()
    assert predictions["model_fold"].eq(predictions["fold"]).all()
    assert len(scores) == 4_508
    assert scores["ID"].is_unique
    assert scores["village_id"].nunique() == 127
    np.testing.assert_array_equal(scores["gamma_benefit"], -scores["gamma_tau"])


def test_village_table_reconciles_counts_signs_and_village_one_values():
    predictions, scores = phase9_inputs()
    villages = village_aggregation.aggregate_villages(predictions, scores)

    assert len(villages) == villages["village_id"].nunique() == 127
    assert villages["n_randomized"].sum() == 4_533
    assert villages["n_evaluation"].sum() == 4_508
    assert villages["n_missing_primary_outcome"].sum() == 25
    assert set(villages["W"]) == {0, 1}
    assert villages.loc[villages["W"].eq(1), "village_id"].nunique() == 64
    assert villages.loc[villages["W"].eq(0), "village_id"].nunique() == 63
    np.testing.assert_array_equal(villages["mean_benefit_grf_oov"], -villages["mean_tau_grf_oov"])
    np.testing.assert_array_equal(villages["mean_benefit_simple_oov"], -villages["mean_tau_simple_oov"])
    np.testing.assert_array_equal(villages["mean_gamma_benefit"], -villages["mean_gamma_tau"])

    village_one = villages.set_index("village_id").loc[1]
    assert village_one["fold"] == 1
    assert village_one["W"] == 1
    assert village_one["n_randomized"] == village_one["n_evaluation"] == 35
    assert village_one["n_missing_primary_outcome"] == 0
    assert np.isclose(village_one["mean_tau_grf_oov"], -2.3921280033929486)
    assert np.isclose(village_one["mean_benefit_grf_oov"], 2.3921280033929486)
    assert np.isclose(village_one["mean_tau_simple_oov"], -1.7993569367959574)
    assert np.isclose(village_one["mean_benefit_simple_oov"], 1.7993569367959574)
    assert np.isclose(village_one["mean_risk0"], 20.771428571428572)
    assert np.isclose(village_one["mean_gamma_tau"], -6.089492578331952)
    assert np.isclose(village_one["mean_gamma_benefit"], 6.089492578331952)

    expected_predictions = predictions.groupby("village_id", sort=True)[
        [
            "tau_hat_grf",
            "benefit_hat_grf",
            "tau_hat_simple_oov",
            "benefit_hat_simple_oov",
            "risk0",
        ]
    ].mean()
    actual_predictions = villages.set_index("village_id")[
        [
            "mean_tau_grf_oov",
            "mean_benefit_grf_oov",
            "mean_tau_simple_oov",
            "mean_benefit_simple_oov",
            "mean_risk0",
        ]
    ]
    actual_predictions.columns = expected_predictions.columns
    pd.testing.assert_frame_equal(actual_predictions, expected_predictions)
    assert np.isclose(
        np.average(villages["mean_benefit_grf_oov"], weights=villages["n_randomized"]),
        predictions["benefit_hat_grf"].mean(),
    )
    assert np.isclose(
        np.average(villages["mean_gamma_benefit"], weights=villages["n_evaluation"]),
        scores["gamma_benefit"].mean(),
    )


def test_gamma_uses_only_evaluation_rows_and_candidate_scores_ignore_treatment():
    predictions, scores = phase9_inputs()
    villages = village_aggregation.aggregate_villages(predictions, scores)
    changed_w = predictions.assign(W=1 - predictions["W"])
    changed = village_aggregation.aggregate_villages(changed_w, scores.assign(W=1 - scores["W"]))

    candidate_columns = [
        "mean_tau_grf_oov",
        "mean_benefit_grf_oov",
        "mean_tau_simple_oov",
        "mean_benefit_simple_oov",
        "mean_risk0",
    ]
    pd.testing.assert_frame_equal(villages[candidate_columns], changed[candidate_columns])
    expected = scores.groupby("village_id", sort=True)[["gamma_tau", "gamma_benefit"]].mean()
    actual = villages.set_index("village_id")[["mean_gamma_tau", "mean_gamma_benefit"]]
    actual.columns = ["gamma_tau", "gamma_benefit"]
    pd.testing.assert_frame_equal(actual, expected)


def test_village_table_contains_no_oracle_rank_policy_or_composite_fields():
    predictions, scores = phase9_inputs()
    villages = village_aggregation.aggregate_villages(predictions, scores)
    columns = {column.lower() for column in villages.columns}

    assert not any(
        token in column
        for column in columns
        for token in ("rank", "selected", "capacity", "policy", "recommend", "deploy", "fund", "composite", "ensemble")
    )
    assert "actual_village_treatment_effect" not in columns
    assert "mean_delta_risk" not in columns
    assert "participant_id" not in columns
    assert "id" not in columns


def test_diagnostics_cover_required_distributions_and_correlations():
    predictions, scores = phase9_inputs()
    villages = village_aggregation.aggregate_villages(predictions, scores)
    diagnostics = village_aggregation.build_diagnostics(villages)

    distribution_variables = set(
        diagnostics.loc[diagnostics["diagnostic_type"].eq("distribution"), "variable_1"]
    )
    assert distribution_variables == {
        "n_randomized",
        "mean_benefit_grf_oov",
        "mean_benefit_simple_oov",
        "mean_risk0",
        "mean_gamma_benefit",
    }
    size_pairs = diagnostics.loc[diagnostics["diagnostic_type"].eq("spearman_size")]
    assert set(size_pairs["variable_2"]) == {
        "mean_benefit_grf_oov",
        "mean_benefit_simple_oov",
        "mean_risk0",
    }
    assert diagnostics["value"].apply(np.isfinite).all()


def test_pipeline_is_deterministic_keeps_upstream_immutable_and_outputs_ignored():
    before = upstream_hashes()
    first = village_aggregation.run_phase9_pipeline(ROOT)
    first_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in first.items()}
    second = village_aggregation.run_phase9_pipeline(ROOT)
    second_hashes = {name: sha256(Path(path).read_bytes()).hexdigest() for name, path in second.items()}

    assert first_hashes == second_hashes
    assert upstream_hashes() == before
    assert set(first) == {"villages", "diagnostics"}
    assert all("data/derived" in Path(path).as_posix() for path in first.values())
    ignored = subprocess.run(
        ["git", "check-ignore", *first.values()],
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
