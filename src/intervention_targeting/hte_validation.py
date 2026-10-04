"""Phase 8 out-of-village HTE validation."""

from hashlib import sha256
from pathlib import Path
import shutil
import subprocess

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm

from intervention_targeting.hte_crossfit import HTE_FEATURE_COLUMNS, stable_frame_hash


EXPECTED_FOLD_HASH = "9ea2d84d063aa3fb6d63b53b36b9c8ac9c7093a55679ca4c5def15d52676eb79"
PROPENSITY = 0.5
RANDOM_PRIORITY_SEED = 8_100
RATE_BOOTSTRAP_REPLICATES = 1_000


def load_phase7_inputs(root: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load and validate frozen Phase-7 model inputs and OOV predictions."""
    derived = Path(root).resolve() / "data" / "derived"
    folds = pd.read_csv(derived / "village_folds.csv")
    manifest = pd.read_csv(derived / "hte_feature_manifest.csv")
    matrix = pd.read_csv(derived / "hte_model_matrix.csv")
    oov = pd.read_csv(derived / "hte_oov_predictions.csv")
    metadata = pd.read_csv(derived / "grf_model_metadata.csv")

    if len(metadata) != 1:
        raise ValueError("Phase-7 GRF metadata must contain one row")
    meta = metadata.iloc[0]
    fold_hash = stable_frame_hash(folds[["village_id", "fold"]], ["village_id"])
    if fold_hash != EXPECTED_FOLD_HASH or str(meta["fold_map_hash"]) != EXPECTED_FOLD_HASH:
        raise ValueError("Phase-7 fold hash changed")
    if len(folds) != 127 or not folds["village_id"].is_unique:
        raise ValueError("Phase-7 fold map must contain 127 unique villages")
    if folds.groupby("village_id")["fold"].nunique().ne(1).any():
        raise ValueError("Phase-7 fold map splits a village")
    if tuple(manifest.loc[manifest["included_in_grf"].eq(1), "feature"]) != HTE_FEATURE_COLUMNS:
        raise ValueError("Phase-7 feature manifest changed")
    if len(matrix) != 4_533 or not matrix["ID"].is_unique:
        raise ValueError("Phase-7 model matrix coverage changed")
    if matrix["village_id"].nunique() != 127 or int(matrix["outcome_observed"].sum()) != 4_508:
        raise ValueError("Phase-7 model matrix population changed")
    if matrix[list(HTE_FEATURE_COLUMNS)].isna().any().any():
        raise ValueError("Phase-7 frozen X is incomplete")
    if len(oov) != 4_533 or not oov["ID"].is_unique or int(oov["evaluation_eligible"].sum()) != 4_508:
        raise ValueError("Phase-7 OOV prediction population changed")
    keys = ["ID", "village_id", "fold"]
    if len(matrix[keys].merge(oov[keys], on=keys, validate="one_to_one")) != 4_533:
        raise ValueError("Phase-7 model matrix and OOV keys differ")
    if not np.array_equal(oov["model_fold"].to_numpy(), oov["fold"].to_numpy()):
        raise ValueError("Phase-7 OOV model folds changed")
    if not np.allclose(oov["benefit_hat_grf"], -oov["tau_hat_grf"], rtol=0, atol=1e-12):
        raise ValueError("Phase-7 GRF benefit sign changed")
    if not np.allclose(
        oov["benefit_hat_simple_oov"], -oov["tau_hat_simple_oov"], rtol=0, atol=1e-12
    ):
        raise ValueError("Phase-7 simple benefit sign changed")
    required_metadata = {
        "feature_count": 22,
        "fold_count": 5,
        "num_trees": 2_000,
        "W_hat": 0.5,
        "clusters": "village_id",
        "tuning": "none",
        "num_threads": 1,
        "max_village_overlap": 0,
    }
    for name, expected in required_metadata.items():
        if meta[name] != expected:
            raise ValueError(f"Phase-7 metadata changed: {name}")
    if str(meta["honesty"]).lower() != "true" or str(meta["equalize_cluster_weights"]).lower() != "false":
        raise ValueError("Phase-7 honesty or cluster weighting changed")
    return matrix, oov


def crossfit_aipw_scores(matrix: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Construct fold-external AIPW scores with arm-specific OLS nuisances."""
    observed = matrix.loc[matrix["outcome_observed"].eq(1)].copy()
    if len(observed) != 4_508 or observed["village_id"].nunique() != 127:
        raise ValueError("evaluation population must contain 4508 participants and 127 villages")
    if observed["delta_risk"].isna().any():
        raise ValueError("evaluation outcomes must be observed without imputation")
    feature_names = list(HTE_FEATURE_COLUMNS)
    rows: list[pd.DataFrame] = []
    audits: list[dict[str, object]] = []
    for fold in range(1, 6):
        train = observed.loc[observed["fold"].ne(fold)]
        test = observed.loc[observed["fold"].eq(fold)].copy()
        train_villages = set(train["village_id"])
        test_villages = set(test["village_id"])
        overlap = train_villages & test_villages
        if overlap:
            raise ValueError(f"nuisance village leakage in fold {fold}")

        train_x = np.column_stack([np.ones(len(train)), train[feature_names].to_numpy(float)])
        test_x = np.column_stack([np.ones(len(test)), test[feature_names].to_numpy(float)])
        predictions: dict[int, np.ndarray] = {}
        arm_counts: dict[int, int] = {}
        for arm in (0, 1):
            arm_rows = train["W"].eq(arm).to_numpy()
            arm_counts[arm] = int(arm_rows.sum())
            coefficients = np.linalg.lstsq(
                train_x[arm_rows], train.loc[arm_rows, "delta_risk"].to_numpy(float), rcond=None
            )[0]
            predictions[arm] = test_x @ coefficients

        w = test["W"].to_numpy(float)
        y = test["delta_risk"].to_numpy(float)
        m0 = predictions[0]
        m1 = predictions[1]
        gamma_tau = (
            m1 - m0
            + w / PROPENSITY * (y - m1)
            - (1 - w) / PROPENSITY * (y - m0)
        )
        rows.append(
            test[["ID", "village_id", "fold", "W", "delta_risk"]].assign(
                m1_hat=m1,
                m0_hat=m0,
                gamma_tau=gamma_tau,
                gamma_benefit=-gamma_tau,
            )
        )
        audits.append(
            {
                "fold": fold,
                "training_rows": len(train),
                "training_control_rows": arm_counts[0],
                "training_intervention_rows": arm_counts[1],
                "training_villages": len(train_villages),
                "heldout_rows": len(test),
                "heldout_villages": len(test_villages),
                "village_overlap": len(overlap),
                "propensity": PROPENSITY,
                "feature_count": len(feature_names),
                "feature_hash": sha256("\n".join(feature_names).encode()).hexdigest(),
            }
        )
    scores = pd.concat(rows, ignore_index=True).sort_values("ID").reset_index(drop=True)
    if len(scores) != 4_508 or not scores["ID"].is_unique:
        raise ValueError("AIPW score coverage is incomplete")
    if not np.isfinite(scores[["m0_hat", "m1_hat", "gamma_tau", "gamma_benefit"]]).all().all():
        raise ValueError("AIPW scores must be finite")
    if not np.array_equal(scores["gamma_benefit"].to_numpy(), -scores["gamma_tau"].to_numpy()):
        raise ValueError("gamma benefit sign differs from negative gamma tau")
    return scores, pd.DataFrame(audits)


def build_priority_frame(scores: pd.DataFrame, oov: pd.DataFrame) -> pd.DataFrame:
    """Join frozen raw scores and add deterministic within-fold priorities."""
    columns = [
        "ID",
        "village_id",
        "fold",
        "evaluation_eligible",
        "risk0",
        "benefit_hat_grf",
        "benefit_hat_simple_oov",
    ]
    frame = scores.merge(oov[columns], on=["ID", "village_id", "fold"], validate="one_to_one")
    if len(frame) != 4_508 or not frame["evaluation_eligible"].eq(1).all():
        raise ValueError("priority frame must equal the outcome-observed population")
    frame = frame.sort_values("ID").reset_index(drop=True)
    frame["random_priority_raw"] = np.random.default_rng(RANDOM_PRIORITY_SEED).random(len(frame))
    raw = {
        "grf": "benefit_hat_grf",
        "simple": "benefit_hat_simple_oov",
        "risk": "risk0",
        "random": "random_priority_raw",
    }
    for rule, column in raw.items():
        frame[f"priority_{rule}_within_fold"] = frame.groupby("fold", sort=True)[column].rank(
            method="first", pct=True
        )
    return frame


def clustered_mean_summary(frame: pd.DataFrame, value: str) -> dict[str, float | int]:
    """Estimate a participant-weighted mean with village-cluster-robust uncertainty."""
    fit = sm.OLS(frame[value].to_numpy(float), np.ones((len(frame), 1))).fit(
        cov_type="cluster", cov_kwds={"groups": frame["village_id"].to_numpy()}
    )
    estimate = float(fit.params[0])
    se = float(fit.bse[0])
    return {
        "estimate": estimate,
        "std_error": se,
        "ci_low": estimate - 1.96 * se,
        "ci_high": estimate + 1.96 * se,
        "participants": len(frame),
        "clusters": int(frame["village_id"].nunique()),
    }


def calibration_summary(frame: pd.DataFrame) -> pd.DataFrame:
    """Fit fold-adjusted OOV calibration slopes with village-clustered SEs."""
    rows = []
    for model, column in (("grf", "benefit_hat_grf"), ("simple", "benefit_hat_simple_oov")):
        centered = frame[column] - frame.groupby("fold")[column].transform("mean")
        folds = pd.get_dummies(frame["fold"], prefix="fold", drop_first=True, dtype=float)
        design = pd.concat(
            [pd.Series(1.0, index=frame.index, name="intercept"), centered.rename("slope"), folds],
            axis=1,
        )
        fit = sm.OLS(frame["gamma_benefit"], design).fit(
            cov_type="cluster", cov_kwds={"groups": frame["village_id"]}
        )
        slope = float(fit.params["slope"])
        se = float(fit.bse["slope"])
        ci_low = slope - 1.96 * se
        ci_high = slope + 1.96 * se
        interpretation = (
            "positive alignment"
            if ci_low > 0
            else "negative alignment"
            if ci_high < 0
            else "inconclusive alignment"
        )
        rows.append(
            {
                "model": model,
                "slope": slope,
                "std_error": se,
                "ci_low": ci_low,
                "ci_high": ci_high,
                "p_value": float(fit.pvalues["slope"]),
                "interpretation": interpretation,
                "participants": len(frame),
                "clusters": int(frame["village_id"].nunique()),
                "fold_adjustment": "indicators_plus_within_fold_centered_raw_prediction",
            }
        )
    return pd.DataFrame(rows)


def quintile_summary(frame: pd.DataFrame) -> pd.DataFrame:
    """Summarize gamma benefit across primary GRF within-fold quintiles."""
    quintile = np.ceil(frame["priority_grf_within_fold"] * 5).clip(1, 5).astype(int)
    rows = []
    for group in range(1, 6):
        subset = frame.loc[quintile.eq(group)]
        summary = clustered_mean_summary(subset, "gamma_benefit")
        rows.append(
            {
                "quintile": group,
                "participant_count": summary.pop("participants"),
                "village_coverage": summary.pop("clusters"),
                **summary,
            }
        )
    return pd.DataFrame(rows)


def ranking_stability(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return raw-score Spearman agreement and fold scale diagnostics."""
    comparisons = (
        ("grf_vs_simple", "benefit_hat_grf", "benefit_hat_simple_oov"),
        ("grf_vs_baseline_risk", "benefit_hat_grf", "risk0"),
        ("simple_vs_baseline_risk", "benefit_hat_simple_oov", "risk0"),
    )
    correlations = pd.DataFrame(
        {
            "comparison": name,
            "spearman": frame[left].rank(method="average").corr(frame[right].rank(method="average")),
        }
        for name, left, right in comparisons
    )
    rules = {
        "grf": ("benefit_hat_grf", "priority_grf_within_fold"),
        "simple": ("benefit_hat_simple_oov", "priority_simple_within_fold"),
        "baseline_risk": ("risk0", "priority_risk_within_fold"),
        "random": ("random_priority_raw", "priority_random_within_fold"),
    }
    diagnostics = []
    for fold, subset in frame.groupby("fold", sort=True):
        for rule, (raw, normalized) in rules.items():
            diagnostics.append(
                {
                    "fold": int(fold),
                    "rule": rule,
                    "participants": len(subset),
                    "raw_mean": subset[raw].mean(),
                    "raw_std": subset[raw].std(),
                    "raw_min": subset[raw].min(),
                    "raw_max": subset[raw].max(),
                    "percentile_mean": subset[normalized].mean(),
                    "percentile_min": subset[normalized].min(),
                    "percentile_max": subset[normalized].max(),
                }
            )
    return correlations, pd.DataFrame(diagnostics)


def _classifications(
    rate: pd.DataFrame, paired: pd.DataFrame, calibration: pd.DataFrame
) -> dict[str, str]:
    primary = rate.loc[(rate["normalization"] == "within_fold") & (rate["target"] == "AUTOC")]
    grf = primary.set_index("rule").loc["grf"]
    grf_calibration = calibration.set_index("model").loc["grf"]
    raw_grf = rate.loc[
        (rate["normalization"] == "raw") & (rate["target"] == "AUTOC") & (rate["rule"] == "grf")
    ].iloc[0]
    qini_grf = rate.loc[
        (rate["normalization"] == "within_fold") & (rate["target"] == "QINI") & (rate["rule"] == "grf")
    ].iloc[0]
    material_reversal = any(
        np.sign(item["estimate"]) != np.sign(grf["estimate"])
        and (item["ci_low"] > 0 or item["ci_high"] < 0)
        for item in (raw_grf, qini_grf)
    )
    if grf["ci_low"] > 0 and grf_calibration["ci_low"] > 0 and not material_reversal:
        grf_label = "SUPPORTED"
    elif grf["estimate"] > 0 or grf_calibration["slope"] > 0:
        grf_label = "LIMITED / MIXED"
    else:
        grf_label = "NOT SUPPORTED"

    differences = paired.set_index("comparison")
    return {
        "grf_hte_validation": grf_label,
        "incremental_grf_vs_simple": (
            "SUPPORTED" if differences.loc["grf_minus_simple", "ci_low"] > 0 else "NOT DEMONSTRATED"
        ),
        "grf_vs_baseline_risk": (
            "SUPPORTED" if differences.loc["grf_minus_baseline_risk", "ci_low"] > 0 else "NOT DEMONSTRATED"
        ),
    }


def _write_toc_figure(toc: pd.DataFrame, path: Path) -> None:
    primary = toc.loc[(toc["normalization"] == "within_fold") & (toc["target"] == "AUTOC")]
    labels = {"grf": "GRF", "simple": "Simple HTE", "baseline_risk": "Baseline risk", "random": "Random"}
    styles = {
        "grf": {"color": "#2F6B9A", "linestyle": "-", "marker": "o"},
        "simple": {"color": "#D98E2B", "linestyle": "--", "marker": "s"},
        "baseline_risk": {"color": "#7A8F3A", "linestyle": "-.", "marker": "^"},
        "random": {"color": "#6B7280", "linestyle": ":", "marker": "D"},
    }
    fig, axis = plt.subplots(figsize=(8, 5))
    for rule, group in primary.groupby("rule", sort=False):
        group = group.sort_values("q")
        axis.plot(group["q"], group["estimate"], label=labels[rule], **styles[rule])
        axis.fill_between(
            group["q"], group["ci_low"], group["ci_high"], color=styles[rule]["color"], alpha=0.10
        )
    axis.axhline(0, color="black", linewidth=0.8, linestyle="--")
    fig.suptitle("Out-of-village targeting operator characteristic", fontsize=13, y=0.98)
    axis.set_title(
        "N=4,508 participants; 127 village clusters; within-fold priorities; bootstrap R=1,000",
        fontsize=9,
        color="#4B5563",
        pad=10,
    )
    axis.set(xlabel="Prioritized participant fraction", ylabel="TOC: benefit above population mean")
    axis.legend(frameon=False)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=160)
    plt.close(fig)


def run_phase8_pipeline(root: str | Path, rscript: str | None = None) -> dict[str, str]:
    """Run frozen-score Phase-8 validation and write audit artifacts."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    matrix, oov = load_phase7_inputs(root)
    scores, nuisance_audit = crossfit_aipw_scores(matrix)
    validation = build_priority_frame(scores, oov)
    overall_tau = clustered_mean_summary(validation, "gamma_tau")
    overall_benefit = clustered_mean_summary(validation, "gamma_benefit")
    calibration = calibration_summary(validation)
    quintiles = quintile_summary(validation)
    correlations, fold_diagnostics = ranking_stability(validation)

    paths = {
        "scores": derived / "hte_evaluation_scores.csv",
        "nuisance_audit": derived / "hte_nuisance_audit.csv",
        "validation_input": derived / "hte_validation_input.csv",
        "rate": derived / "hte_validation_summary.csv",
        "paired": derived / "paired_rate_comparisons.csv",
        "toc": derived / "toc_curve.csv",
        "calibration": derived / "calibration_summary.csv",
        "quintiles": derived / "hte_quintile_diagnostic.csv",
        "correlations": derived / "ranking_stability.csv",
        "fold_diagnostics": derived / "fold_priority_diagnostics.csv",
        "overall": derived / "aipw_overall_summary.csv",
        "classification": derived / "hte_evidence_classification.csv",
        "figure": root / "reports" / "figures" / "hte_toc_comparison.png",
    }
    scores.to_csv(paths["scores"], index=False)
    nuisance_audit.to_csv(paths["nuisance_audit"], index=False)
    validation.to_csv(paths["validation_input"], index=False)
    pd.DataFrame(
        [
            {"quantity": "gamma_tau", **overall_tau},
            {"quantity": "gamma_benefit", **overall_benefit},
        ]
    ).to_csv(paths["overall"], index=False)
    calibration.to_csv(paths["calibration"], index=False)
    quintiles.to_csv(paths["quintiles"], index=False)
    correlations.to_csv(paths["correlations"], index=False)
    fold_diagnostics.to_csv(paths["fold_diagnostics"], index=False)

    executable = rscript or shutil.which("Rscript")
    if not executable:
        raise RuntimeError("Rscript is required for Phase 8 RATE validation")
    subprocess.run(
        [
            executable,
            str(root / "r" / "hte_rate_validation.R"),
            str(paths["validation_input"]),
            str(paths["rate"]),
            str(paths["paired"]),
            str(paths["toc"]),
        ],
        cwd=root,
        check=True,
    )
    rate = pd.read_csv(paths["rate"])
    paired = pd.read_csv(paths["paired"])
    labels = _classifications(rate, paired, calibration)
    pd.DataFrame(
        {"question": labels.keys(), "classification": labels.values()}
    ).to_csv(paths["classification"], index=False)
    _write_toc_figure(pd.read_csv(paths["toc"]), paths["figure"])
    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = run_phase8_pipeline(root)
    summary = pd.read_csv(paths["rate"])
    print(
        "Phase-8 HTE validation artifacts written: "
        f"RATE rows={len(summary)}, bootstrap R={RATE_BOOTSTRAP_REPLICATES}"
    )


if __name__ == "__main__":
    main()
