"""Classical Phase 6 treatment-effect heterogeneity analytics."""

from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from intervention_targeting.trial_effects import (
    GROUP_COLUMN,
    MODEL_FORMULA,
    build_primary_model_frame,
)


matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


MODERATOR_SPECS = {
    "age": {
        "label": "Age",
        "raw_field": "age",
        "indicator": "age_ge_60",
        "source_definition": "<60 vs >=60 years",
        "subgroup_labels": ("<60 years", ">=60 years"),
        "reconstruction_status": "VERIFIED",
        "source_effects": (-1.88, -1.80),
        "source_interaction_p": "0.81",
    },
    "sex": {
        "label": "Sex",
        "raw_field": "male",
        "indicator": "male",
        "source_definition": "women vs men",
        "subgroup_labels": ("Women", "Men"),
        "reconstruction_status": "VERIFIED",
        "source_effects": (-1.58, -2.18),
        "source_interaction_p": "0.048",
    },
    "education": {
        "label": "Education",
        "raw_field": "education_high_above",
        "indicator": "education_high_above",
        "source_definition": "below high school vs high school or above",
        "subgroup_labels": ("Below high school", "High school or above"),
        "reconstruction_status": "VERIFIED",
        "source_effects": (-1.84, -2.10),
        "source_interaction_p": "0.79",
    },
    "occupation": {
        "label": "Occupation",
        "raw_field": "occupation_farmer",
        "indicator": "occupation_farmer",
        "source_definition": "non-agricultural vs agricultural worker",
        "subgroup_labels": ("Non-agricultural worker", "Agricultural worker"),
        "reconstruction_status": "VERIFIED",
        "source_effects": (-2.63, -1.64),
        "source_interaction_p": "0.03",
    },
    "income": {
        "label": "Annual household income",
        "raw_field": "Last_year_income_lt_10k",
        "indicator": "Last_year_income_lt_10k",
        "source_definition": ">=10000 vs <10000 yuan",
        "subgroup_labels": (">=10,000 yuan", "<10,000 yuan"),
        "reconstruction_status": "VERIFIED",
        "source_effects": (-1.73, -2.70),
        "source_interaction_p": "0.02",
    },
    "baseline_risk": {
        "label": "Baseline 10-year ASCVD risk",
        "raw_field": "risk0",
        "indicator": "risk_ge_16",
        "source_definition": "<16 vs >=16%",
        "subgroup_labels": ("<16%", ">=16%"),
        "reconstruction_status": "PARTIALLY RECONSTRUCTABLE",
        "source_effects": (-1.16, -2.54),
        "source_interaction_p": "<0.001",
    },
}

SIMPLE_INTERACTION_TERMS = (
    "W:age_ge_60",
    "W:male",
    "W:education_high_above",
    "W:occupation_farmer",
    "W:Last_year_income_lt_10k",
    "W:risk_ge_16",
)
SIMPLE_HTE_FORMULA = (
    MODEL_FORMULA
    + " + age_ge_60 + risk_ge_16 + "
    + " + ".join(SIMPLE_INTERACTION_TERMS)
)
Z_975 = 1.959963984540054


def prepare_analysis_frame(cohort: pd.DataFrame) -> pd.DataFrame:
    """Build the locked outcome-observed frame and deterministic subgroup indicators."""
    frame = build_primary_model_frame(cohort).copy()
    frame["age_ge_60"] = frame["age"].ge(60).astype("int8")
    frame["risk_ge_16"] = frame["risk0"].ge(16).astype("int8")
    indicators = [spec["indicator"] for spec in MODERATOR_SPECS.values()]
    if frame[indicators].isna().any().any():
        raise ValueError("Phase-6 moderator indicators must be complete")
    return frame


def subgroup_support(frame: pd.DataFrame) -> pd.DataFrame:
    """Return arm- and village-aware aggregate support for every frozen subgroup."""
    rows = []
    for moderator, spec in MODERATOR_SPECS.items():
        indicator = spec["indicator"]
        for subgroup_value, subgroup_label in enumerate(spec["subgroup_labels"]):
            for treatment, arm in ((0, "Control"), (1, "Intervention")):
                subset = frame.loc[(frame[indicator] == subgroup_value) & (frame["W"] == treatment)]
                rows.append(
                    {
                        "moderator": moderator,
                        "moderator_label": spec["label"],
                        "subgroup_value": subgroup_value,
                        "subgroup": subgroup_label,
                        "W": treatment,
                        "arm": arm,
                        "analysis_n": len(subset),
                        "villages": subset[GROUP_COLUMN].nunique(),
                        "missing_n": int(frame[spec["raw_field"]].isna().sum()),
                        "reconstruction_status": spec["reconstruction_status"],
                    }
                )
    return pd.DataFrame(rows)


def interaction_specification(moderator: str) -> tuple[str, str]:
    """Return the frozen adjusted formula and its treatment-interaction term."""
    if moderator not in MODERATOR_SPECS:
        raise ValueError(f"unsupported moderator: {moderator}")
    indicator = MODERATOR_SPECS[moderator]["indicator"]
    interaction = f"W:{indicator}"
    if indicator in {"age_ge_60", "risk_ge_16"}:
        return f"{MODEL_FORMULA} + {indicator} + {interaction}", interaction
    return f"{MODEL_FORMULA} + {interaction}", interaction


def fit_moderator_model(frame: pd.DataFrame, moderator: str):
    """Fit one source-aligned adjusted random-intercept interaction model."""
    formula, _ = interaction_specification(moderator)
    return smf.mixedlm(
        formula,
        data=frame,
        groups=frame[GROUP_COLUMN],
        re_formula="1",
    ).fit(reml=True, method="powell", maxiter=500, disp=False)


def _linear_effect(fit, terms: tuple[str, ...]) -> tuple[float, float, float, float]:
    weights = pd.Series(0.0, index=fit.params.index)
    weights[list(terms)] = 1.0
    estimate = float(weights @ fit.params)
    variance = float(weights @ fit.cov_params() @ weights)
    std_error = float(np.sqrt(variance))
    return estimate, std_error, estimate - Z_975 * std_error, estimate + Z_975 * std_error


def _subgroup_effect_rows(fit, frame: pd.DataFrame, moderator: str) -> list[dict]:
    spec = MODERATOR_SPECS[moderator]
    _, interaction = interaction_specification(moderator)
    rows = []
    for subgroup_value, subgroup_label in enumerate(spec["subgroup_labels"]):
        terms = ("W",) if subgroup_value == 0 else ("W", interaction)
        estimate, std_error, lower, upper = _linear_effect(fit, terms)
        subset = frame.loc[frame[spec["indicator"]] == subgroup_value]
        rows.append(
            {
                "moderator": moderator,
                "moderator_label": spec["label"],
                "subgroup_value": subgroup_value,
                "subgroup": subgroup_label,
                "analysis_n": len(subset),
                "villages": subset[GROUP_COLUMN].nunique(),
                "control_n": int((subset["W"] == 0).sum()),
                "intervention_n": int((subset["W"] == 1).sum()),
                "control_villages": subset.loc[subset["W"] == 0, GROUP_COLUMN].nunique(),
                "intervention_villages": subset.loc[subset["W"] == 1, GROUP_COLUMN].nunique(),
                "treatment_effect": estimate,
                "std_error": std_error,
                "ci_lower": lower,
                "ci_upper": upper,
                "source_treatment_effect": spec["source_effects"][subgroup_value],
                "reconstruction_status": spec["reconstruction_status"],
            }
        )
    return rows


def _interaction_row(fit, frame: pd.DataFrame, moderator: str) -> dict:
    spec = MODERATOR_SPECS[moderator]
    formula, term = interaction_specification(moderator)
    estimate = float(fit.params[term])
    std_error = float(fit.bse[term])
    comparison = (
        "PUBLIC RISK-GROUP MEMBERSHIP DIFFERS"
        if moderator == "baseline_risk"
        else "BROADLY CONSISTENT"
    )
    return {
        "moderator": moderator,
        "moderator_label": spec["label"],
        "analysis_n": len(frame),
        "villages": frame[GROUP_COLUMN].nunique(),
        "model_formula": formula,
        "interaction_term": term,
        "interaction_effect": estimate,
        "interaction_se": std_error,
        "interaction_ci_lower": estimate - Z_975 * std_error,
        "interaction_ci_upper": estimate + Z_975 * std_error,
        "interaction_p_value": float(fit.pvalues[term]),
        "source_interaction_p_value": spec["source_interaction_p"],
        "source_comparison_status": comparison,
        "reconstruction_status": spec["reconstruction_status"],
        "converged": bool(fit.converged),
    }


def benjamini_hochberg(p_values) -> np.ndarray:
    """Return supplementary Benjamini-Hochberg adjusted values."""
    p_values = np.asarray(p_values, dtype=float)
    order = np.argsort(p_values)
    ranked = p_values[order] * len(p_values) / np.arange(1, len(p_values) + 1)
    adjusted = np.minimum.accumulate(ranked[::-1])[::-1].clip(0, 1)
    result = np.empty_like(adjusted)
    result[order] = adjusted
    return result


def estimate_all_moderators(
    frame: pd.DataFrame, primary: dict
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fit and report the complete frozen moderator set without selection."""
    effect_rows = [
        {
            "moderator": "Overall",
            "moderator_label": "Overall",
            "subgroup_value": pd.NA,
            "subgroup": "Overall",
            "analysis_n": int(primary["analysis_n"]),
            "villages": int(primary["villages"]),
            "control_n": 2_224,
            "intervention_n": 2_284,
            "control_villages": 63,
            "intervention_villages": 64,
            "treatment_effect": float(primary["estimate"]),
            "std_error": float(primary["std_error"]),
            "ci_lower": float(primary["ci_lower"]),
            "ci_upper": float(primary["ci_upper"]),
            "source_treatment_effect": -1.88,
            "reconstruction_status": "CANONICAL PHASE-4 RESULT",
        }
    ]
    interaction_rows = []
    for moderator in MODERATOR_SPECS:
        fit = fit_moderator_model(frame, moderator)
        effect_rows.extend(_subgroup_effect_rows(fit, frame, moderator))
        interaction_rows.append(_interaction_row(fit, frame, moderator))
    interactions = pd.DataFrame(interaction_rows)
    interactions["bh_q_value"] = benjamini_hochberg(interactions["interaction_p_value"])
    return pd.DataFrame(effect_rows), interactions


def effect_to_benefit(effect):
    """Convert scientific treatment-effect sign to stakeholder benefit sign."""
    return -effect


def fit_simple_hte_benchmark(frame: pd.DataFrame):
    """Fit the one frozen full-sample classical HTE benchmark."""
    return smf.mixedlm(
        SIMPLE_HTE_FORMULA,
        data=frame,
        groups=frame[GROUP_COLUMN],
        re_formula="1",
    ).fit(reml=True, method="powell", maxiter=500, disp=False)


def summarize_simple_hte_benchmark(fit, frame: pd.DataFrame) -> pd.DataFrame:
    """Return aggregate treatment-related coefficients from the simple benchmark."""
    rows = []
    for term in ("W", *SIMPLE_INTERACTION_TERMS):
        lower, upper = fit.conf_int().loc[term]
        rows.append(
            {
                "model": "single_prespecified_classical_hte_benchmark",
                "term": term,
                "analysis_n": len(frame),
                "villages": frame[GROUP_COLUMN].nunique(),
                "estimate": float(fit.params[term]),
                "std_error": float(fit.bse[term]),
                "ci_lower": float(lower),
                "ci_upper": float(upper),
                "p_value": float(fit.pvalues[term]),
                "converged": bool(fit.converged),
                "use_boundary": "description_only_not_policy_evidence",
            }
        )
    return pd.DataFrame(rows)


def write_aggregate_outputs(tables: dict[str, pd.DataFrame], output_dir: str | Path) -> None:
    """Write deterministic aggregate-only Phase-6 tables."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        if {"ID", GROUP_COLUMN} & set(table.columns):
            raise ValueError("Phase-6 exports cannot contain participant or village identifiers")
        table.to_csv(output_dir / f"{name}.csv", index=False)


def plot_subgroup_effects(effects: pd.DataFrame, output_path: str | Path) -> None:
    """Export one forest plot for the overall and complete subgroup effect set."""
    plot_data = effects.copy()
    plot_data["plot_label"] = np.where(
        plot_data["moderator"].eq("Overall"),
        "Overall",
        plot_data["moderator_label"] + ": " + plot_data["subgroup"],
    )
    plot_data["plot_label"] += "  (N=" + plot_data["analysis_n"].astype(str) + ")"
    positions = np.arange(len(plot_data))[::-1]
    fig, ax = plt.subplots(figsize=(10, 8.2))
    errors = np.vstack(
        [
            plot_data["treatment_effect"] - plot_data["ci_lower"],
            plot_data["ci_upper"] - plot_data["treatment_effect"],
        ]
    )
    colors = np.where(plot_data["moderator"].eq("Overall"), "#C17C00", "#2463A6")
    ax.errorbar(
        plot_data["treatment_effect"],
        positions,
        xerr=errors,
        fmt="none",
        ecolor="#4A4A4A",
        elinewidth=1.2,
        capsize=3,
        zorder=2,
    )
    ax.scatter(plot_data["treatment_effect"], positions, c=colors, s=44, zorder=3)
    ax.axvline(0, color="#555555", linestyle="--", linewidth=1.1)
    ax.set_yticks(positions, plot_data["plot_label"])
    ax.set_xlabel("Adjusted intervention-control effect (percentage points)")
    ax.set_ylabel("")
    ax.set_title("Classical subgroup treatment effects", loc="left", weight="bold", pad=30)
    ax.text(
        0,
        1.01,
        "Negative values favor intervention; intervals are 95% large-sample Wald CIs.",
        transform=ax.transAxes,
        color="#444444",
        fontsize=9,
    )
    ax.grid(axis="x", color="#E0E0E0", linewidth=0.7)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path,
        dpi=160,
        bbox_inches="tight",
        metadata={"Software": "cardiovascular-intervention-targeting"},
    )
    plt.close(fig)
