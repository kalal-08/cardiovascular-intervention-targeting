"""Independently reproduce the published SMARTER primary trial effect."""

from pathlib import Path

import pandas as pd
import statsmodels.formula.api as smf


OUTCOME = "delta_risk"
GROUP_COLUMN = "village_id"
PUBLISHED_ESTIMATE = -1.88
PUBLISHED_CI = (-2.57, -1.19)
REPRODUCTION_TOLERANCE = 0.25

CATEGORICAL_EFFECTS = (
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
)
FIXED_EFFECTS = (
    "W",
    "risk0",
    "age",
    *CATEGORICAL_EFFECTS,
)
MODEL_FORMULA = "delta_risk ~ W + risk0 + age + " + " + ".join(
    f"C({column})" for column in CATEGORICAL_EFFECTS
)


def build_primary_model_frame(cohort: pd.DataFrame) -> pd.DataFrame:
    """Select the observed-outcome population without silent covariate exclusions."""
    required = {
        "ID",
        "group",
        GROUP_COLUMN,
        OUTCOME,
        "risk4",
        "primary_outcome_observed",
        *FIXED_EFFECTS,
    }
    missing_columns = sorted(required - set(cohort.columns))
    if missing_columns:
        raise ValueError(f"causal cohort missing required columns: {missing_columns}")

    frame = cohort.loc[cohort["primary_outcome_observed"]].copy()
    if len(cohort) != 4_533 or len(frame) != 4_508:
        raise ValueError("causal cohort population differs from the locked Phase-3 contract")
    if frame[[OUTCOME, GROUP_COLUMN, *FIXED_EFFECTS]].isna().any().any():
        raise ValueError("primary model requires additional undocumented missing-data exclusions")
    if not (frame["W"] == frame["group"].map({1: 1, 2: 0})).all():
        raise ValueError("W mapping differs from the locked treatment contract")
    if not frame.groupby(GROUP_COLUMN)["W"].nunique().eq(1).all():
        raise ValueError("treatment must remain constant within village")

    return frame


def describe_by_arm(frame: pd.DataFrame) -> pd.DataFrame:
    """Return the bounded descriptive checks required for reproduction."""
    return (
        frame.groupby("W", sort=True)
        .agg(
            n=("ID", "size"),
            villages=(GROUP_COLUMN, "nunique"),
            mean_risk0=("risk0", "mean"),
            mean_risk4=("risk4", "mean"),
            mean_delta_risk=(OUTCOME, "mean"),
            sd_delta_risk=(OUTCOME, "std"),
        )
        .reset_index()
    )


def fit_primary_model(frame: pd.DataFrame):
    """Fit the adjusted Gaussian random-intercept model using REML."""
    model = smf.mixedlm(
        MODEL_FORMULA,
        data=frame,
        groups=frame[GROUP_COLUMN],
        re_formula="1",
    )
    return model.fit(reml=True, method="powell", maxiter=500, disp=False)


def summarize_primary_result(fit, frame: pd.DataFrame) -> dict[str, float | int | str | bool]:
    """Extract the intervention-minus-control coefficient and Wald inference."""
    lower, upper = fit.conf_int().loc["W"]
    return {
        "model": "primary_adjusted_mixed_model_reml",
        "analysis_n": len(frame),
        "villages": frame[GROUP_COLUMN].nunique(),
        "estimate": float(fit.params["W"]),
        "std_error": float(fit.bse["W"]),
        "ci_lower": float(lower),
        "ci_upper": float(upper),
        "test_statistic": float(fit.tvalues["W"]),
        "p_value": float(fit.pvalues["W"]),
        "converged": bool(fit.converged),
    }


def compare_with_publication(estimate: float, ci_lower: float, ci_upper: float) -> dict[str, float | bool | str]:
    """Apply the Phase-4 implementation reproduction gate."""
    difference = abs(estimate - PUBLISHED_ESTIMATE)
    same_direction = estimate < 0
    ci_overlaps = ci_lower <= PUBLISHED_CI[1] and ci_upper >= PUBLISHED_CI[0]
    same_conclusion = ci_upper < 0
    reproduced = (
        difference <= REPRODUCTION_TOLERANCE
        and same_direction
        and ci_overlaps
        and same_conclusion
    )
    return {
        "published_estimate": PUBLISHED_ESTIMATE,
        "published_ci_lower": PUBLISHED_CI[0],
        "published_ci_upper": PUBLISHED_CI[1],
        "absolute_estimate_difference": difference,
        "same_direction": same_direction,
        "ci_overlaps": ci_overlaps,
        "same_substantive_conclusion": same_conclusion,
        "reproduction_status": "REPRODUCED" if reproduced else "NOT REPRODUCED — BLOCKER",
    }


def write_aggregate_result(result: dict, output_path: str | Path) -> None:
    """Write one aggregate-only reproduction record."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame([result]).to_csv(output_path, index=False)
