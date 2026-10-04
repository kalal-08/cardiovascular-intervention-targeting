"""Phase 9 village aggregation of frozen participant-level OOV signals."""

from pathlib import Path

import numpy as np
import pandas as pd

from intervention_targeting.hte_validation import load_phase7_inputs


def load_phase9_inputs(root: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load and reconcile frozen Phase-7 predictions and Phase-8 evaluation scores."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    _, predictions = load_phase7_inputs(root)
    scores = pd.read_csv(derived / "hte_evaluation_scores.csv")
    simple = pd.read_csv(derived / "simple_hte_oov_predictions.csv")
    simple_audit = pd.read_csv(derived / "simple_hte_crossfit_audit.csv")
    overall = pd.read_csv(derived / "aipw_overall_summary.csv").set_index("quantity")
    rate = pd.read_csv(derived / "hte_validation_summary.csv")
    calibration = pd.read_csv(derived / "calibration_summary.csv").set_index("model")
    classification = pd.read_csv(derived / "hte_evidence_classification.csv").set_index(
        "question"
    )["classification"]

    keys = ["ID", "village_id", "fold"]
    if len(scores) != 4_508 or not scores["ID"].is_unique or scores["village_id"].nunique() != 127:
        raise ValueError("Phase-8 evaluation-score population changed")
    if not np.isfinite(scores[["gamma_tau", "gamma_benefit"]]).all().all():
        raise ValueError("Phase-8 gamma scores must be finite")
    if not np.array_equal(scores["gamma_benefit"].to_numpy(), -scores["gamma_tau"].to_numpy()):
        raise ValueError("Phase-8 gamma sign changed")
    eligible = predictions.loc[predictions["evaluation_eligible"].eq(1), keys + ["W"]]
    score_keys = scores[keys + ["W"]]
    aligned = eligible.merge(score_keys, on=keys, suffixes=("_prediction", "_score"), validate="one_to_one")
    if len(aligned) != 4_508 or not aligned["W_prediction"].eq(aligned["W_score"]).all():
        raise ValueError("Phase-8 gamma keys do not match evaluation-eligible predictions")

    if len(simple) != 4_533 or not simple["ID"].is_unique:
        raise ValueError("Phase-7 simple OOV coverage changed")
    simple_check = predictions[keys + ["tau_hat_simple_oov", "benefit_hat_simple_oov"]].merge(
        simple[keys + ["model_fold", "tau_hat_simple_oov", "benefit_hat_simple_oov"]],
        on=keys,
        suffixes=("_merged", "_source"),
        validate="one_to_one",
    )
    if not simple_check["model_fold"].eq(simple_check["fold"]).all():
        raise ValueError("Phase-7 simple model fold changed")
    for field in ("tau_hat_simple_oov", "benefit_hat_simple_oov"):
        if not np.array_equal(simple_check[f"{field}_merged"], simple_check[f"{field}_source"]):
            raise ValueError(f"Phase-7 merged simple predictions changed: {field}")
    if len(simple_audit) != 5 or not simple_audit["village_overlap"].eq(0).all():
        raise ValueError("Phase-7 simple OOV village-exclusion audit changed")

    if not np.isclose(overall.loc["gamma_tau", "estimate"], -1.8640556239554662):
        raise ValueError("Phase-8 gamma tau mean changed")
    if not np.isclose(overall.loc["gamma_benefit", "estimate"], 1.8640556239554662):
        raise ValueError("Phase-8 gamma benefit mean changed")
    primary = rate.loc[
        rate["normalization"].eq("within_fold") & rate["target"].eq("AUTOC")
    ].set_index("rule")
    expected_autoc = {
        "grf": 0.638241556908981,
        "simple": 0.731039536132118,
        "baseline_risk": 0.881798765373343,
    }
    if any(not np.isclose(primary.loc[rule, "estimate"], value) for rule, value in expected_autoc.items()):
        raise ValueError("Phase-8 primary AUTOC results changed")
    if not np.isclose(calibration.loc["grf", "slope"], 0.9160201563896807) or not np.isclose(
        calibration.loc["simple", "slope"], 0.8820341208625424
    ):
        raise ValueError("Phase-8 calibration results changed")
    expected_classification = {
        "grf_hte_validation": "SUPPORTED",
        "incremental_grf_vs_simple": "NOT DEMONSTRATED",
        "grf_vs_baseline_risk": "NOT DEMONSTRATED",
    }
    if classification.to_dict() != expected_classification:
        raise ValueError("Phase-8 evidence classification changed")
    return predictions, scores


def aggregate_villages(predictions: pd.DataFrame, scores: pd.DataFrame) -> pd.DataFrame:
    """Aggregate frozen OOV predictions and evaluation-only gamma scores by village."""
    if len(predictions) != 4_533 or predictions["village_id"].nunique() != 127:
        raise ValueError("prediction aggregation requires 4533 participants and 127 villages")
    if predictions.groupby("village_id")[["fold", "W", "model_fold"]].nunique().ne(1).any().any():
        raise ValueError("fold, treatment, and model fold must be village-constant")
    if not predictions["model_fold"].eq(predictions["fold"]).all():
        raise ValueError("GRF predictions are not from each village's held-out fold")
    if predictions[["tau_hat_grf", "benefit_hat_grf", "tau_hat_simple_oov", "benefit_hat_simple_oov", "risk0"]].isna().any().any():
        raise ValueError("prediction aggregation inputs must be complete")
    if not np.allclose(predictions["benefit_hat_grf"], -predictions["tau_hat_grf"], rtol=0, atol=1e-12):
        raise ValueError("participant GRF benefit sign changed")
    if not np.allclose(
        predictions["benefit_hat_simple_oov"], -predictions["tau_hat_simple_oov"], rtol=0, atol=1e-12
    ):
        raise ValueError("participant simple benefit sign changed")

    village = (
        predictions.groupby("village_id", sort=True)
        .agg(
            fold=("fold", "first"),
            W=("W", "first"),
            n_randomized=("ID", "size"),
            n_evaluation=("evaluation_eligible", "sum"),
            mean_tau_grf_oov=("tau_hat_grf", "mean"),
            mean_benefit_grf_oov=("benefit_hat_grf", "mean"),
            mean_tau_simple_oov=("tau_hat_simple_oov", "mean"),
            mean_benefit_simple_oov=("benefit_hat_simple_oov", "mean"),
            mean_risk0=("risk0", "mean"),
        )
        .reset_index()
    )
    village["n_evaluation"] = village["n_evaluation"].astype(int)
    village["n_missing_primary_outcome"] = village["n_randomized"] - village["n_evaluation"]

    score_required = {"ID", "village_id", "fold", "W", "gamma_tau", "gamma_benefit"}
    if score_required - set(scores.columns) or len(scores) != 4_508 or not scores["ID"].is_unique:
        raise ValueError("evaluation score input is incomplete")
    if not np.array_equal(scores["gamma_benefit"].to_numpy(), -scores["gamma_tau"].to_numpy()):
        raise ValueError("gamma benefit sign changed")
    eligible_keys = predictions.loc[predictions["evaluation_eligible"].eq(1), ["ID", "village_id", "fold", "W"]]
    if len(eligible_keys.merge(scores[["ID", "village_id", "fold", "W"]], validate="one_to_one")) != 4_508:
        raise ValueError("gamma rows differ from evaluation-eligible participants")
    gamma = (
        scores.groupby("village_id", sort=True)
        .agg(
            gamma_rows=("ID", "size"),
            mean_gamma_tau=("gamma_tau", "mean"),
            mean_gamma_benefit=("gamma_benefit", "mean"),
        )
        .reset_index()
    )
    village = village.merge(gamma, on="village_id", validate="one_to_one")
    if not village["gamma_rows"].eq(village["n_evaluation"]).all():
        raise ValueError("village gamma counts differ from evaluation counts")
    village = village.drop(columns="gamma_rows")

    exact_sign_pairs = (
        ("mean_benefit_grf_oov", "mean_tau_grf_oov"),
        ("mean_benefit_simple_oov", "mean_tau_simple_oov"),
        ("mean_gamma_benefit", "mean_gamma_tau"),
    )
    for benefit, tau in exact_sign_pairs:
        if not np.array_equal(village[benefit].to_numpy(), -village[tau].to_numpy()):
            raise ValueError(f"village sign reconciliation failed: {benefit}")
    if village["n_randomized"].sum() != 4_533 or village["n_evaluation"].sum() != 4_508:
        raise ValueError("village population totals do not reconcile")
    if village["n_missing_primary_outcome"].sum() != 25:
        raise ValueError("village missing-outcome total does not equal 25")
    columns = [
        "village_id",
        "fold",
        "W",
        "n_randomized",
        "n_evaluation",
        "n_missing_primary_outcome",
        "mean_tau_grf_oov",
        "mean_benefit_grf_oov",
        "mean_tau_simple_oov",
        "mean_benefit_simple_oov",
        "mean_risk0",
        "mean_gamma_tau",
        "mean_gamma_benefit",
    ]
    return village[columns].sort_values("village_id").reset_index(drop=True)


def build_diagnostics(villages: pd.DataFrame) -> pd.DataFrame:
    """Build compact descriptive village distributions and Spearman correlations."""
    rows: list[dict[str, object]] = []
    distribution_fields = (
        "n_randomized",
        "mean_benefit_grf_oov",
        "mean_benefit_simple_oov",
        "mean_risk0",
        "mean_gamma_benefit",
    )
    for field in distribution_fields:
        values = villages[field]
        for statistic, value in (
            ("mean", values.mean()),
            ("sd", values.std()),
            ("minimum", values.min()),
            ("median", values.median()),
            ("maximum", values.max()),
        ):
            rows.append(
                {
                    "diagnostic_type": "distribution",
                    "variable_1": field,
                    "variable_2": "",
                    "statistic": statistic,
                    "value": value,
                }
            )
    score_pairs = (
        ("mean_benefit_grf_oov", "mean_benefit_simple_oov"),
        ("mean_benefit_grf_oov", "mean_risk0"),
        ("mean_benefit_simple_oov", "mean_risk0"),
        ("mean_benefit_grf_oov", "mean_gamma_benefit"),
        ("mean_benefit_simple_oov", "mean_gamma_benefit"),
    )
    for left, right in score_pairs:
        rows.append(
            {
                "diagnostic_type": "spearman_score",
                "variable_1": left,
                "variable_2": right,
                "statistic": "spearman",
                "value": villages[left].rank(method="average").corr(
                    villages[right].rank(method="average")
                ),
            }
        )
    for score in ("mean_benefit_grf_oov", "mean_benefit_simple_oov", "mean_risk0"):
        rows.append(
            {
                "diagnostic_type": "spearman_size",
                "variable_1": "n_randomized",
                "variable_2": score,
                "statistic": "spearman",
                "value": villages["n_randomized"].rank(method="average").corr(
                    villages[score].rank(method="average")
                ),
            }
        )
    return pd.DataFrame(rows)


def run_phase9_pipeline(root: str | Path) -> dict[str, str]:
    """Write canonical village aggregation and compact diagnostics."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    predictions, scores = load_phase9_inputs(root)
    villages = aggregate_villages(predictions, scores)
    diagnostics = build_diagnostics(villages)
    paths = {
        "villages": derived / "village_benefit_summary.csv",
        "diagnostics": derived / "village_aggregation_diagnostics.csv",
    }
    villages.to_csv(paths["villages"], index=False)
    diagnostics.to_csv(paths["diagnostics"], index=False)
    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = run_phase9_pipeline(root)
    villages = pd.read_csv(paths["villages"])
    print(
        "Phase-9 village aggregation written: "
        f"villages={len(villages)}, randomized={int(villages['n_randomized'].sum())}, "
        f"evaluation={int(villages['n_evaluation'].sum())}"
    )


if __name__ == "__main__":
    main()
