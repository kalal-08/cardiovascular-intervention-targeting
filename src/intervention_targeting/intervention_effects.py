"""Aggregate Phase 5 intervention-effect analytics."""

from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from intervention_targeting.trial_effects import CATEGORICAL_EFFECTS, GROUP_COLUMN


matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


CONTINUOUS_BALANCE_VARIABLES = ("age", "risk0", "SBP0", "DBP0", "GLU0", "NHDL0")
BINARY_BALANCE_VARIABLES = (
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
)
SECONDARY_OUTCOMES = {
    "SBP": ("SBP0", "SBP4", "mm Hg"),
    "DBP": ("DBP0", "DBP4", "mm Hg"),
    "GLU": ("GLU0", "GLU4", "mmol/L"),
    "NHDL": ("NHDL0", "NHDL4", "mmol/L"),
}
CLUSTER_CONTEXT_CONTINUOUS = ("age", "risk0", "SBP0")
CLUSTER_CONTEXT_DESIGN = ("vc_age_grp", "vc_sbp_grp", "vc_risk_grp", "doctor_college_above")

VARIABLE_LABELS = {
    "age": "Age",
    "risk0": "10-year ASCVD risk",
    "SBP0": "Systolic blood pressure",
    "DBP0": "Diastolic blood pressure",
    "GLU0": "Fasting glucose",
    "NHDL0": "Non-HDL cholesterol",
    "male": "Male",
    "education_high_above": "High-school education or above",
    "occupation_farmer": "Farmer",
    "Last_year_income_lt_10k": "Annual household income <10k",
    "marriage_yes": "Married",
    "insure_yes": "Social medical insurance",
    "smk_daily_0": "Daily smoking",
    "PA_lt3000_0": "Insufficient physical activity",
    "vc_age_grp": "Village mean-age factor: level 1",
    "vc_sbp_grp": "Village mean-SBP factor: level 1",
    "vc_risk_grp": "Village mean-risk factor: level 1",
    "doctor_college_above": "Village doctor education: level 1",
}


def standardized_mean_difference(
    intervention: pd.Series, control: pd.Series, variable_type: str
) -> float:
    """Calculate intervention-minus-control standardized difference."""
    intervention = intervention.dropna().astype(float)
    control = control.dropna().astype(float)
    if variable_type == "continuous":
        denominator = np.sqrt((intervention.var(ddof=1) + control.var(ddof=1)) / 2)
    elif variable_type == "binary":
        p1, p0 = intervention.mean(), control.mean()
        denominator = np.sqrt((p1 * (1 - p1) + p0 * (1 - p0)) / 2)
    else:
        raise ValueError(f"unsupported variable type: {variable_type}")
    difference = intervention.mean() - control.mean()
    if denominator == 0:
        return 0.0 if difference == 0 else float(np.sign(difference) * np.inf)
    return float(difference / denominator)


def baseline_balance(cohort: pd.DataFrame) -> pd.DataFrame:
    """Summarize a fixed compact pre-treatment balance set without p-values."""
    rows = []
    for variable in (*CONTINUOUS_BALANCE_VARIABLES, *BINARY_BALANCE_VARIABLES):
        kind = "continuous" if variable in CONTINUOUS_BALANCE_VARIABLES else "binary"
        intervention = cohort.loc[cohort["W"] == 1, variable]
        control = cohort.loc[cohort["W"] == 0, variable]
        if kind == "binary" and set(cohort[variable].dropna().unique()) == {1, 2}:
            intervention = intervention.eq(1).astype(int)
            control = control.eq(1).astype(int)
        rows.append(
            {
                "variable": variable,
                "label": VARIABLE_LABELS[variable],
                "type": kind,
                "control_n": int(control.notna().sum()),
                "intervention_n": int(intervention.notna().sum()),
                "control_mean_or_prop": float(control.mean()),
                "intervention_mean_or_prop": float(intervention.mean()),
                "control_sd": float(control.std(ddof=1)),
                "intervention_sd": float(intervention.std(ddof=1)),
                "smd": standardized_mean_difference(intervention, control, kind),
            }
        )
    result = pd.DataFrame(rows)
    result["abs_smd"] = result["smd"].abs()
    return result


def cluster_balance_context(cohort: pd.DataFrame) -> pd.DataFrame:
    """Summarize village-level baseline context without exposing identifiers."""
    grouped = cohort.groupby([GROUP_COLUMN, "W"])
    if grouped[list(CLUSTER_CONTEXT_DESIGN)].nunique().to_numpy().max() > 1:
        raise ValueError("Design fields must be constant within village")
    village = grouped[list(CLUSTER_CONTEXT_CONTINUOUS)].mean().join(
        grouped[list(CLUSTER_CONTEXT_DESIGN)].first()
    ).reset_index()
    village[list(CLUSTER_CONTEXT_DESIGN)] = (village[list(CLUSTER_CONTEXT_DESIGN)] == 1).astype(int)
    rows = []
    for treatment, arm in ((0, "Control"), (1, "Intervention")):
        subset = village.loc[village["W"] == treatment]
        for variable in (*CLUSTER_CONTEXT_CONTINUOUS, *CLUSTER_CONTEXT_DESIGN):
            values = subset[variable]
            rows.append(
                {
                    "W": treatment,
                    "arm": arm,
                    "variable": variable,
                    "summary_type": (
                        "village_mean"
                        if variable in CLUSTER_CONTEXT_CONTINUOUS
                        else "level_1_proportion"
                    ),
                    "villages": len(values),
                    "mean_village_mean": float(values.mean()),
                    "sd_village_mean": float(values.std(ddof=1)),
                    "q25_village_mean": float(values.quantile(0.25)),
                    "median_village_mean": float(values.median()),
                    "q75_village_mean": float(values.quantile(0.75)),
                }
            )
    return pd.DataFrame(rows)


def primary_risk_summary(cohort: pd.DataFrame) -> pd.DataFrame:
    """Return arm and overall distributions for locked primary-risk fields."""
    rows = []
    subsets = (
        ("Overall", cohort),
        ("Control", cohort.loc[cohort["W"] == 0]),
        ("Intervention", cohort.loc[cohort["W"] == 1]),
    )
    for arm, subset in subsets:
        for measure in ("risk0", "risk4", "delta_risk"):
            values = subset[measure].dropna()
            rows.append(
                {
                    "arm": arm,
                    "measure": measure,
                    "randomized_n": len(subset),
                    "n": len(values),
                    "missing": int(subset[measure].isna().sum()),
                    "mean": float(values.mean()),
                    "sd": float(values.std(ddof=1)),
                    "q25": float(values.quantile(0.25)),
                    "median": float(values.median()),
                    "q75": float(values.quantile(0.75)),
                }
            )
    return pd.DataFrame(rows)


def read_canonical_primary_effect(path: str | Path) -> dict:
    """Read and validate the frozen Phase-4 aggregate result without refitting."""
    frame = pd.read_csv(path)
    if len(frame) != 1 or frame.loc[0, "reproduction_status"] != "REPRODUCED":
        raise ValueError("canonical Phase-4 reproduction result is not valid")
    result = frame.iloc[0].to_dict()
    result["analysis_n"] = int(result["analysis_n"])
    result["villages"] = int(result["villages"])
    result["contrast"] = "intervention_minus_control"
    return result


def build_secondary_model_frame(cohort: pd.DataFrame, outcome: str) -> pd.DataFrame:
    """Construct one complete-case secondary change frame without imputation."""
    if outcome not in SECONDARY_OUTCOMES:
        raise ValueError(f"unsupported secondary outcome: {outcome}")
    baseline, followup, _ = SECONDARY_OUTCOMES[outcome]
    change = f"{outcome}_change"
    required = ["W", GROUP_COLUMN, "age", baseline, followup, *CATEGORICAL_EFFECTS]
    frame = cohort.loc[cohort[baseline].notna() & cohort[followup].notna()].copy()
    if frame[required].isna().any().any():
        raise ValueError(f"{outcome} model requires undocumented covariate exclusions")
    frame[change] = frame[followup] - frame[baseline]
    if not frame.groupby(GROUP_COLUMN)["W"].nunique().eq(1).all():
        raise ValueError("treatment must remain constant within village")
    return frame


def estimate_secondary_effects(cohort: pd.DataFrame) -> pd.DataFrame:
    """Fit the fixed source-aligned set of contextual secondary mixed models."""
    rows = []
    categorical = " + ".join(f"C({column})" for column in CATEGORICAL_EFFECTS)
    for outcome, (baseline, _, unit) in SECONDARY_OUTCOMES.items():
        frame = build_secondary_model_frame(cohort, outcome)
        change = f"{outcome}_change"
        formula = f"{change} ~ W + {baseline} + age + {categorical}"
        fit = smf.mixedlm(
            formula,
            data=frame,
            groups=frame[GROUP_COLUMN],
            re_formula="1",
        ).fit(reml=True, method="powell", maxiter=500, disp=False)
        lower, upper = fit.conf_int().loc["W"]
        rows.append(
            {
                "outcome": outcome,
                "unit": unit,
                "change_definition": f"{SECONDARY_OUTCOMES[outcome][1]} - {baseline}",
                "favorable_direction": "negative",
                "analysis_n": len(frame),
                "villages": frame[GROUP_COLUMN].nunique(),
                "estimate": float(fit.params["W"]),
                "std_error": float(fit.bse["W"]),
                "ci_lower": float(lower),
                "ci_upper": float(upper),
                "p_value": float(fit.pvalues["W"]),
                "converged": bool(fit.converged),
            }
        )
    return pd.DataFrame(rows)


def intervention_effect_summary(primary: dict, secondary: pd.DataFrame) -> pd.DataFrame:
    """Combine frozen primary and complete prespecified secondary effects."""
    primary_row = {
        "outcome": "ASCVD risk",
        "classification": "Primary",
        "unit": "percentage points",
        "analysis_n": primary["analysis_n"],
        "villages": primary["villages"],
        "estimate": primary["estimate"],
        "std_error": primary["std_error"],
        "ci_lower": primary["ci_lower"],
        "ci_upper": primary["ci_upper"],
        "p_value": primary["p_value"],
        "favorable_direction": "negative",
        "source": "canonical Phase-4 reproduction",
    }
    rows = [primary_row]
    for row in secondary.to_dict("records"):
        rows.append(
            {
                "outcome": row["outcome"],
                "classification": "Secondary/contextual",
                "unit": row["unit"],
                "analysis_n": row["analysis_n"],
                "villages": row["villages"],
                "estimate": row["estimate"],
                "std_error": row["std_error"],
                "ci_lower": row["ci_lower"],
                "ci_upper": row["ci_upper"],
                "p_value": row["p_value"],
                "favorable_direction": row["favorable_direction"],
                "source": "Phase-5 source-aligned mixed model",
            }
        )
    return pd.DataFrame(rows)


def outcome_change_summary(cohort: pd.DataFrame) -> pd.DataFrame:
    """Summarize observed baseline-to-follow-up changes for all analyzed outcomes."""
    outcomes = {"ASCVD risk": ("risk0", "risk4", "percentage points"), **SECONDARY_OUTCOMES}
    rows = []
    for outcome, (baseline, followup, unit) in outcomes.items():
        for treatment, arm in ((0, "Control"), (1, "Intervention")):
            subset = cohort.loc[cohort["W"] == treatment]
            observed = subset.loc[subset[baseline].notna() & subset[followup].notna()]
            change = observed[followup] - observed[baseline]
            rows.append(
                {
                    "outcome": outcome,
                    "unit": unit,
                    "W": treatment,
                    "arm": arm,
                    "randomized_n": len(subset),
                    "analysis_n": len(observed),
                    "missing_followup_n": int(subset[followup].isna().sum()),
                    "baseline_mean": float(observed[baseline].mean()),
                    "followup_mean": float(observed[followup].mean()),
                    "mean_change": float(change.mean()),
                    "sd_change": float(change.std(ddof=1)),
                }
            )
    return pd.DataFrame(rows)


def missingness_summary(cohort: pd.DataFrame) -> pd.DataFrame:
    """Report outcome-specific baseline/follow-up availability by arm."""
    outcomes = {"ASCVD risk": ("risk0", "risk4"), **{
        name: fields[:2] for name, fields in SECONDARY_OUTCOMES.items()
    }}
    rows = []
    for outcome, (baseline, followup) in outcomes.items():
        for treatment, arm in ((0, "Control"), (1, "Intervention")):
            subset = cohort.loc[cohort["W"] == treatment]
            rows.append(
                {
                    "outcome": outcome,
                    "W": treatment,
                    "arm": arm,
                    "randomized_n": len(subset),
                    "baseline_observed_n": int(subset[baseline].notna().sum()),
                    "followup_observed_n": int(subset[followup].notna().sum()),
                    "model_n": int((subset[baseline].notna() & subset[followup].notna()).sum()),
                    "missing_followup_n": int(subset[followup].isna().sum()),
                }
            )
    return pd.DataFrame(rows)


def write_aggregate_tables(tables: dict[str, pd.DataFrame], output_dir: str | Path) -> None:
    """Write deterministic aggregate tables with no participant identifiers."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        if "ID" in table.columns or GROUP_COLUMN in table.columns:
            raise ValueError("aggregate output cannot contain participant or village identifiers")
        table.to_csv(output_dir / f"{name}.csv", index=False)


def plot_baseline_balance(balance: pd.DataFrame, output_path: str | Path) -> None:
    """Export a compact absolute-SMD Love plot."""
    plot_data = balance.sort_values("abs_smd", ascending=True)
    fig, ax = plt.subplots(figsize=(9, 7.5))
    ax.scatter(plot_data["abs_smd"], plot_data["label"], color="#2463A6", s=42, zorder=3)
    ax.axvline(0.10, color="#555555", linestyle="--", linewidth=1.2, label="0.10 diagnostic guide")
    ax.set_xlabel("Absolute standardized mean difference")
    ax.set_ylabel("")
    ax.set_title("Baseline balance by randomized arm", loc="left", weight="bold", pad=30)
    ax.text(
        0,
        1.01,
        "Participant-level summaries; 4,533 randomized participants. No significance tests.",
        transform=ax.transAxes,
        color="#444444",
        fontsize=9,
    )
    ax.grid(axis="x", color="#DDDDDD", linewidth=0.7)
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path,
        dpi=160,
        bbox_inches="tight",
        metadata={"Software": "cardiovascular-intervention-targeting"},
    )
    plt.close(fig)


def plot_primary_risk_distributions(cohort: pd.DataFrame, output_path: str | Path) -> None:
    """Export baseline, follow-up, and change distributions by randomized arm."""
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.8))
    panels = (
        ("risk0", "Baseline risk"),
        ("risk4", "12-month risk"),
        ("delta_risk", "Change: follow-up minus baseline"),
    )
    for ax, (measure, title) in zip(axes, panels):
        control = cohort.loc[cohort["W"] == 0, measure].dropna()
        intervention = cohort.loc[cohort["W"] == 1, measure].dropna()
        box = ax.boxplot(
            [control, intervention],
            tick_labels=["Control", "Intervention"],
            patch_artist=True,
            showfliers=False,
            widths=0.55,
        )
        box["boxes"][0].set(facecolor="#FFFFFF", edgecolor="#333333", hatch="//")
        box["boxes"][1].set(facecolor="#DCEAF7", edgecolor="#2463A6")
        for median in box["medians"]:
            median.set(color="#111111", linewidth=1.4)
        ax.set_title(title, fontsize=10, weight="bold")
        ax.grid(axis="y", color="#E3E3E3", linewidth=0.7)
        if measure == "delta_risk":
            ax.axhline(0, color="#555555", linestyle="--", linewidth=1)
    axes[0].set_ylabel("Predicted 10-year ASCVD risk (percentage points)")
    fig.suptitle("Primary risk distributions by randomized arm", x=0.055, ha="left", weight="bold")
    fig.text(
        0.055,
        0.93,
        "Boxes show participant distributions; observed within-arm change is not an individual treatment effect.",
        color="#444444",
        fontsize=9,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.88))
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path,
        dpi=160,
        bbox_inches="tight",
        metadata={"Software": "cardiovascular-intervention-targeting"},
    )
    plt.close(fig)
