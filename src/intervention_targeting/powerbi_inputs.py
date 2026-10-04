"""Deterministic aggregate Power BI inputs from frozen Phase-4--11 outputs."""

from pathlib import Path

import numpy as np
import pandas as pd

from intervention_targeting.rollout_policy import OVERALL_GAMMA_BENEFIT


FINAL_CONCLUSION = "NO SINGLE ROBUST POLICY WINNER ESTABLISHED"
ANCHORS = (13, 32, 64, 95, 127)
POLICY_LABELS = {
    "grf": ("GRF", "predictive_causal_hte", "Frozen OOV GRF-predicted village benefit"),
    "simple": ("Simple HTE", "predictive_causal_hte", "Frozen OOV simple-model-predicted village benefit"),
    "baseline_risk": ("Baseline risk", "heuristic", "Pretreatment risk burden; not a treatment-benefit estimate"),
}
EQUITY_NOTE = "Coverage comparisons are descriptive and are not fairness-optimization criteria."

TABLE_SPECS = {
    "dim_policy": {
        "grain": "one row per candidate rollout policy",
        "keys": ["policy"],
        "rows": 3,
        "source": "data/derived/policy_village_priorities.csv",
        "meaning": "Policy labels and scientific roles",
        "joins": "policy to rollout, anchor, robustness, and equity facts",
        "category": "mixed by policy",
    },
    "dim_capacity": {
        "grain": "one row per whole-village capacity K",
        "keys": ["capacity_villages"],
        "rows": 128,
        "source": "data/derived/policy_capacity_curve.csv",
        "meaning": "Complete K=0..127 capacity axis and fixed-anchor flags",
        "joins": "capacity_villages to capacity-aware facts",
        "category": "descriptive",
    },
    "bi_intervention_summary": {
        "grain": "one overall SMARTER trial summary row",
        "keys": ["summary_id"],
        "rows": 1,
        "source": "data/derived/trial_reproduction.csv; outcome_missingness.csv; village_benefit_summary.csv; final_phase11_conclusion.csv",
        "meaning": "Trial counts, frozen primary effect, sign convention, and final policy conclusion",
        "joins": "disconnected page-level table",
        "category": "causal and descriptive",
    },
    "bi_hte_validation": {
        "grain": "one frozen HTE validation metric or classification",
        "keys": ["validation_id"],
        "rows": 22,
        "source": "data/derived/hte_validation_summary.csv; calibration_summary.csv; hte_evidence_classification.csv; ranking_stability.csv; village_aggregation_diagnostics.csv",
        "meaning": "RATE, calibration, evidence, and aggregate ranking-agreement evidence",
        "joins": "disconnected page-level table",
        "category": "mixed validation and descriptive",
    },
    "bi_village_priority": {
        "grain": "one row per anonymized randomized village",
        "keys": ["village_id"],
        "rows": 127,
        "source": "data/derived/policy_village_priorities.csv",
        "meaning": "Separate policy-specific candidate signals, percentiles, and ranks",
        "joins": "disconnected page-level table; no fact-to-fact joins",
        "category": "predictive causal HTE and heuristic",
    },
    "bi_rollout_capacity": {
        "grain": "one row per policy and whole-village capacity K",
        "keys": ["policy", "capacity_villages"],
        "rows": 384,
        "source": "data/derived/policy_capacity_curve.csv; policy_uncertainty_curve.csv",
        "meaning": "Frozen rollout value path, random expectation, gain, and pointwise uncertainty",
        "joins": "many-to-one to dim_policy and dim_capacity",
        "category": "causal policy evaluation",
    },
    "bi_rollout_anchor": {
        "grain": "one row per policy and fixed anchor K",
        "keys": ["policy", "capacity_villages"],
        "rows": 15,
        "source": "data/derived/anchor_policy_uncertainty.csv; capacity_advantage_labels.csv; policy_capacity_curve.csv",
        "meaning": "Frozen five-anchor rollout and uncertainty checkpoints",
        "joins": "many-to-one to dim_policy and dim_capacity",
        "category": "causal policy evaluation",
    },
    "bi_policy_robustness": {
        "grain": "one row per policy and non-full inferential anchor K",
        "keys": ["policy", "capacity_villages"],
        "rows": 12,
        "source": "data/derived/final_policy_robustness_summary.csv; raw_ranking_robustness.csv; equal_village_sensitivity.csv",
        "meaning": "Frozen Phase-11 robustness synthesis",
        "joins": "many-to-one to dim_policy and dim_capacity",
        "category": "causal policy evaluation and sensitivity",
    },
    "bi_policy_overlap": {
        "grain": "one row per policy pair and fixed anchor K",
        "keys": ["comparison", "capacity_villages"],
        "rows": 15,
        "source": "data/derived/policy_anchor_overlap.csv",
        "meaning": "Descriptive selected-village overlap between policy pairs",
        "joins": "many-to-one to dim_capacity only; policy-left/right remain labels",
        "category": "descriptive",
    },
    "bi_equity_coverage": {
        "grain": "one row per policy, anchor, dimension, and subgroup category",
        "keys": ["policy", "capacity_villages", "dimension", "category"],
        "rows": 150,
        "source": "data/derived/equity_coverage_summary.csv",
        "meaning": "Aggregate descriptive coverage; never a fairness criterion",
        "joins": "many-to-one to dim_policy and dim_capacity",
        "category": "descriptive",
    },
    "bi_classical_subgroup_effects": {
        "grain": "one overall or reconstructed classical subgroup-effect row",
        "keys": ["subgroup_effect_id"],
        "rows": 13,
        "source": "data/derived/classical_subgroup_effects.csv",
        "meaning": "Frozen Phase-6 classical subgroup effect summaries",
        "joins": "disconnected page-level table",
        "category": "causal subgroup estimate",
    },
}

RELATIONSHIPS = (
    ("dim_policy", "policy", "bi_rollout_capacity", "policy", "1:*", "single"),
    ("dim_policy", "policy", "bi_rollout_anchor", "policy", "1:*", "single"),
    ("dim_policy", "policy", "bi_policy_robustness", "policy", "1:*", "single"),
    ("dim_policy", "policy", "bi_equity_coverage", "policy", "1:*", "single"),
    ("dim_capacity", "capacity_villages", "bi_rollout_capacity", "capacity_villages", "1:*", "single"),
    ("dim_capacity", "capacity_villages", "bi_rollout_anchor", "capacity_villages", "1:*", "single"),
    ("dim_capacity", "capacity_villages", "bi_policy_robustness", "capacity_villages", "1:*", "single"),
    ("dim_capacity", "capacity_villages", "bi_policy_overlap", "capacity_villages", "1:*", "single"),
    ("dim_capacity", "capacity_villages", "bi_equity_coverage", "capacity_villages", "1:*", "single"),
)


def _read(derived: Path, name: str) -> pd.DataFrame:
    return pd.read_csv(derived / name)


def _build_intervention(derived: Path) -> pd.DataFrame:
    trial = _read(derived, "trial_reproduction.csv").iloc[0]
    missingness = _read(derived, "outcome_missingness.csv")
    primary = missingness[missingness["outcome"].eq("ASCVD risk")]
    villages = _read(derived, "village_benefit_summary.csv")
    conclusion = _read(derived, "final_phase11_conclusion.csv").iloc[0]
    arms = primary.set_index("arm")
    village_arms = villages.groupby("W").size()
    if len(trial.to_frame().T) != 1 or len(primary) != 2 or len(villages) != 127:
        raise ValueError("frozen trial summary grain changed")
    if conclusion["final_phase11_conclusion"] != FINAL_CONCLUSION:
        raise ValueError("Phase-11 final conclusion changed")
    return pd.DataFrame(
        [{
            "summary_id": "SMARTER_PRIMARY",
            "randomized_participants": int(primary["randomized_n"].sum()),
            "evaluation_participants": int(primary["model_n"].sum()),
            "missing_primary_outcome": int(primary["missing_followup_n"].sum()),
            "villages": int(trial["villages"]),
            "intervention_participants": int(arms.loc["Intervention", "randomized_n"]),
            "control_participants": int(arms.loc["Control", "randomized_n"]),
            "intervention_villages": int(village_arms.loc[1]),
            "control_villages": int(village_arms.loc[0]),
            "primary_outcome": "Predicted 10-year ASCVD risk",
            "outcome_unit": "percentage points",
            "treatment_effect_estimate": trial["estimate"],
            "treatment_effect_std_error": trial["std_error"],
            "treatment_effect_ci_lower": trial["ci_lower"],
            "treatment_effect_ci_upper": trial["ci_upper"],
            "effect_favorable_direction": "lower",
            "benefit_sign_convention": "positive benefit equals a reduction in predicted ASCVD risk",
            "analysis_population": "randomized participants with observed primary follow-up outcome",
            "reproduction_status": trial["reproduction_status"],
            "final_policy_conclusion": conclusion["final_phase11_conclusion"],
        }]
    )


def _build_hte(derived: Path) -> pd.DataFrame:
    rows: list[dict] = []
    validation = _read(derived, "hte_validation_summary.csv")
    for row in validation.itertuples(index=False):
        category = "heuristic_validation" if row.rule == "baseline_risk" else (
            "sanity_check" if row.rule == "random" else "predictive_causal_hte_validation"
        )
        rows.append({
            "validation_id": f"rate:{row.normalization}:{row.target}:{row.rule}",
            "metric": row.target,
            "model_or_comparison": row.rule,
            "normalization": row.normalization,
            "estimate": row.estimate,
            "std_error": row.std_error,
            "ci_lower": row.ci_low,
            "ci_upper": row.ci_high,
            "classification": pd.NA,
            "participants": 4508,
            "clusters": row.clusters,
            "bootstrap_replicates": row.bootstrap_replicates,
            "unit": "validation score",
            "scientific_category": category,
        })
    calibration = _read(derived, "calibration_summary.csv")
    for row in calibration.itertuples(index=False):
        rows.append({
            "validation_id": f"calibration:{row.model}",
            "metric": "calibration_slope",
            "model_or_comparison": row.model,
            "normalization": "fold_adjusted",
            "estimate": row.slope,
            "std_error": row.std_error,
            "ci_lower": row.ci_low,
            "ci_upper": row.ci_high,
            "classification": row.interpretation,
            "participants": row.participants,
            "clusters": row.clusters,
            "bootstrap_replicates": pd.NA,
            "unit": "slope",
            "scientific_category": "predictive_causal_hte_validation",
        })
    evidence = _read(derived, "hte_evidence_classification.csv")
    for row in evidence.itertuples(index=False):
        rows.append({
            "validation_id": f"evidence:{row.question}",
            "metric": "evidence_classification",
            "model_or_comparison": row.question,
            "normalization": "predeclared_rule",
            "estimate": pd.NA,
            "std_error": pd.NA,
            "ci_lower": pd.NA,
            "ci_upper": pd.NA,
            "classification": row.classification,
            "participants": 4508,
            "clusters": 127,
            "bootstrap_replicates": pd.NA,
            "unit": "classification",
            "scientific_category": "evidence_classification",
        })
    ranking = _read(derived, "ranking_stability.csv")
    for row in ranking.itertuples(index=False):
        rows.append({
            "validation_id": f"participant_spearman:{row.comparison}",
            "metric": "priority_spearman",
            "model_or_comparison": row.comparison,
            "normalization": "raw_participant_scores",
            "estimate": row.spearman,
            "std_error": pd.NA,
            "ci_lower": pd.NA,
            "ci_upper": pd.NA,
            "classification": pd.NA,
            "participants": 4533,
            "clusters": 127,
            "bootstrap_replicates": pd.NA,
            "unit": "correlation",
            "scientific_category": "descriptive",
        })
    diagnostics = _read(derived, "village_aggregation_diagnostics.csv")
    diagnostics = diagnostics[
        diagnostics["diagnostic_type"].eq("spearman_score")
        & ~diagnostics["variable_2"].eq("mean_gamma_benefit")
    ]
    for row in diagnostics.itertuples(index=False):
        comparison = f"{row.variable_1}_vs_{row.variable_2}"
        rows.append({
            "validation_id": f"village_spearman:{comparison}",
            "metric": "village_signal_spearman",
            "model_or_comparison": comparison,
            "normalization": "village_aggregate",
            "estimate": row.value,
            "std_error": pd.NA,
            "ci_lower": pd.NA,
            "ci_upper": pd.NA,
            "classification": pd.NA,
            "participants": 4533,
            "clusters": 127,
            "bootstrap_replicates": pd.NA,
            "unit": "correlation",
            "scientific_category": "descriptive",
        })
    return pd.DataFrame(rows)


def _build_village_priority(derived: Path) -> pd.DataFrame:
    source = _read(derived, "policy_village_priorities.csv")
    result = source[[
        "village_id", "n_randomized", "n_evaluation", "n_missing_primary_outcome",
        "mean_benefit_grf_oov", "mean_benefit_simple_oov", "mean_risk0",
        "grf_priority_percentile", "grf_eval_rank", "simple_priority_percentile",
        "simple_eval_rank", "risk_priority_percentile", "risk_eval_rank",
    ]].rename(columns={
        "mean_benefit_grf_oov": "grf_predicted_benefit",
        "mean_benefit_simple_oov": "simple_predicted_benefit",
        "mean_risk0": "baseline_risk",
        "grf_eval_rank": "grf_candidate_rank",
        "simple_eval_rank": "simple_candidate_rank",
        "risk_eval_rank": "baseline_risk_candidate_rank",
        "risk_priority_percentile": "baseline_risk_priority_percentile",
    })
    return result.sort_values("village_id").reset_index(drop=True)


def _build_rollout_capacity(derived: Path) -> pd.DataFrame:
    curve = _read(derived, "policy_capacity_curve.csv")
    uncertainty = _read(derived, "policy_uncertainty_curve.csv")
    keys = ["policy", "capacity_villages"]
    merged = curve.merge(uncertainty, on=keys, how="inner", validate="one_to_one")
    checks = (
        ("population_rollout_value", "point_population_rollout_value"),
        ("random_expected_value", "point_random_expected_value"),
        ("value_gain_vs_random", "point_gain_vs_random"),
    )
    for left, right in checks:
        if not np.allclose(merged[left], merged[right], rtol=0, atol=1e-12):
            raise ValueError(f"frozen rollout point values disagree: {left}")
    result = merged[[
        "policy", "capacity_villages", "capacity_share_villages", "selected_villages",
        "n_selected_randomized", "randomized_coverage", "n_selected_evaluation",
        "evaluation_coverage", "selected_mean_gamma_benefit",
        "point_population_rollout_value", "point_random_expected_value",
        "point_gain_vs_random", "population_value_ci_lower", "population_value_ci_upper",
        "gain_ci_lower", "gain_ci_upper", "interval_type", "bootstrap_replicates",
    ]].rename(columns={"selected_mean_gamma_benefit": "selected_mean_evaluated_benefit"})
    result["is_fixed_anchor"] = result["capacity_villages"].isin(ANCHORS)
    result["scientific_category"] = "causal_policy_evaluation"
    return result.sort_values(keys).reset_index(drop=True)


def _build_rollout_anchor(derived: Path, capacity: pd.DataFrame) -> pd.DataFrame:
    anchor = _read(derived, "anchor_policy_uncertainty.csv")
    labels = _read(derived, "capacity_advantage_labels.csv")[[
        "policy", "capacity_villages", "capacity_advantage_label"
    ]]
    coverage = capacity[capacity["is_fixed_anchor"]][[
        "policy", "capacity_villages", "selected_villages", "n_selected_randomized",
        "randomized_coverage", "n_selected_evaluation", "evaluation_coverage",
        "selected_mean_evaluated_benefit",
    ]]
    keys = ["policy", "capacity_villages"]
    result = anchor.merge(labels, on=keys, how="left", validate="one_to_one").merge(
        coverage, on=keys, how="left", validate="one_to_one"
    )
    full = result["capacity_villages"].eq(127)
    result.loc[full, "capacity_advantage_label"] = "RECONCILIATION ENDPOINT"
    result["anchor_role"] = np.where(full, "reconciliation", "fixed_inference")
    result["scientific_category"] = "causal_policy_evaluation"
    return result.sort_values(keys).reset_index(drop=True)


def _build_robustness(derived: Path) -> pd.DataFrame:
    result = _read(derived, "final_policy_robustness_summary.csv")
    keys = ["policy", "capacity_villages"]
    raw = _read(derived, "raw_ranking_robustness.csv")
    raw = raw[raw["capacity_villages"].isin(ANCHORS[:-1])][keys + [
        "raw_global_rollout_value", "raw_minus_primary_value", "raw_ranking_gain_vs_random",
        "shared_villages", "jaccard_overlap",
    ]]
    equal = _read(derived, "equal_village_sensitivity.csv")
    equal = equal[equal["capacity_villages"].isin(ANCHORS[:-1])][keys + [
        "equal_village_rollout_value", "equal_village_gain_vs_random", "estimand_label",
    ]]
    result = result.merge(raw, on=keys, validate="one_to_one").merge(
        equal, on=keys, validate="one_to_one"
    )
    result["scientific_category"] = "causal_policy_evaluation_and_sensitivity"
    return result.sort_values(keys).reset_index(drop=True)


def _build_overlap(derived: Path) -> pd.DataFrame:
    result = _read(derived, "policy_anchor_overlap.csv").copy()
    result["scientific_category"] = "descriptive"
    return result.sort_values(["capacity_villages", "comparison"]).reset_index(drop=True)


def _build_equity(derived: Path) -> pd.DataFrame:
    result = _read(derived, "equity_coverage_summary.csv")[[
        "policy", "capacity_villages", "capacity_role", "dimension", "dimension_label",
        "category", "n_subgroup_total", "n_subgroup_covered", "subgroup_coverage",
        "n_overall_covered", "overall_randomized_coverage", "coverage_gap",
    ]].copy()
    result["analysis_note"] = EQUITY_NOTE
    result["scientific_category"] = "descriptive"
    return result.sort_values(["policy", "capacity_villages", "dimension", "category"]).reset_index(drop=True)


def _build_subgroups(derived: Path) -> pd.DataFrame:
    source = _read(derived, "classical_subgroup_effects.csv")
    result = source.drop(columns=["subgroup_value", "source_treatment_effect"]).copy()
    result.insert(0, "subgroup_effect_id", [f"subgroup_{index:02d}" for index in range(len(result))])
    result["unit"] = "percentage points of predicted 10-year ASCVD risk"
    result["favorable_direction"] = "lower"
    result["scientific_category"] = "causal_subgroup_estimate"
    return result


def build_powerbi_tables(root: str | Path) -> dict[str, pd.DataFrame]:
    """Build the compact, aggregate-only Phase-12A reporting model in memory."""
    derived = Path(root).resolve() / "data" / "derived"
    dim_policy = pd.DataFrame([
        {
            "policy": policy,
            "policy_label": values[0],
            "scientific_category": values[1],
            "priority_signal": values[2],
            "higher_priority_direction": "higher",
        }
        for policy, values in POLICY_LABELS.items()
    ])
    dim_capacity = pd.DataFrame({"capacity_villages": range(128)})
    dim_capacity["capacity_share_villages"] = dim_capacity["capacity_villages"] / 127
    dim_capacity["is_fixed_anchor"] = dim_capacity["capacity_villages"].isin(ANCHORS)
    dim_capacity["capacity_role"] = np.select(
        [dim_capacity["capacity_villages"].eq(127), dim_capacity["is_fixed_anchor"]],
        ["reconciliation", "fixed_inference"],
        default="curve_only",
    )
    capacity = _build_rollout_capacity(derived)
    tables = {
        "dim_policy": dim_policy,
        "dim_capacity": dim_capacity,
        "bi_intervention_summary": _build_intervention(derived),
        "bi_hte_validation": _build_hte(derived),
        "bi_village_priority": _build_village_priority(derived),
        "bi_rollout_capacity": capacity,
        "bi_rollout_anchor": _build_rollout_anchor(derived, capacity),
        "bi_policy_robustness": _build_robustness(derived),
        "bi_policy_overlap": _build_overlap(derived),
        "bi_equity_coverage": _build_equity(derived),
        "bi_classical_subgroup_effects": _build_subgroups(derived),
    }
    for name, frame in tables.items():
        spec = TABLE_SPECS[name]
        if len(frame) != spec["rows"] or frame.duplicated(spec["keys"]).any():
            raise ValueError(f"{name} violates its documented grain")
    return tables


def _power_query_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "True/False"
    if pd.api.types.is_integer_dtype(series):
        return "Whole Number"
    if pd.api.types.is_numeric_dtype(series):
        return "Decimal Number"
    return "Text"


def _unit(column: str) -> str:
    lower = column.lower()
    if lower.startswith("is_") or lower.endswith("_established"):
        return "boolean"
    if any(token in lower for token in ("coverage", "share", "percentile", "jaccard")):
        return "proportion"
    if any(token in lower for token in ("participants", "villages", "clusters", "replicates", "_n", "count")):
        return "count"
    if "rank" in lower:
        return "ordinal rank"
    if any(token in lower for token in ("effect", "benefit", "risk", "rollout_value", "gain", "ci_lower", "ci_upper", "std_error", "coverage_gap")):
        return "percentage points unless table metric states otherwise"
    if "slope" in lower:
        return "slope"
    if "spearman" in lower or "correlation" in lower:
        return "correlation"
    return "text/category or table-specific value"


def _favorability(column: str) -> str:
    lower = column.lower()
    if "treatment_effect" in lower or lower == "favorable_direction":
        return "lower favors intervention"
    if any(token in lower for token in ("predicted_benefit", "rollout_value", "gain_vs_random")):
        return "higher indicates more evaluated/predicted benefit; not a recommendation"
    if "baseline_risk" in lower:
        return "higher is higher risk burden, not higher causal benefit"
    return "not applicable or descriptive"


def build_data_dictionary(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Return one documented row per exported table column."""
    rows = []
    for name, frame in tables.items():
        spec = TABLE_SPECS[name]
        for column in frame.columns:
            rows.append({
                "table_name": name,
                "grain": spec["grain"],
                "primary_key": " + ".join(spec["keys"]),
                "row_count": len(frame),
                "source_artifact": spec["source"],
                "table_meaning": spec["meaning"],
                "allowed_joins": spec["joins"],
                "column_name": column,
                "power_query_type": _power_query_type(frame[column]),
                "nullable": bool(frame[column].isna().any()),
                "metric_unit": _unit(column),
                "favorability": _favorability(column),
                "scientific_category": spec["category"],
                "column_meaning": column.replace("_", " "),
            })
    return pd.DataFrame(rows)


def _target(target_id, group, source, field, numeric=pd.NA, text=pd.NA, policy=pd.NA, capacity=pd.NA, unit="count", page=""):
    return {
        "target_id": target_id,
        "target_group": group,
        "policy": policy,
        "capacity_villages": capacity,
        "expected_numeric": numeric,
        "expected_text": text,
        "unit": unit,
        "source_artifact": f"data/derived/{source}",
        "source_field": field,
        "dashboard_page": page,
        "numeric_tolerance": 1e-12 if numeric is not pd.NA else pd.NA,
    }


def build_reconciliation_targets(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Extract exact machine-readable dashboard checkpoints from frozen sources."""
    summary = tables["bi_intervention_summary"].iloc[0]
    targets = []
    study_sources = {
        "randomized_participants": ("outcome_missingness.csv", "randomized_n"),
        "evaluation_participants": ("outcome_missingness.csv", "model_n"),
        "missing_primary_outcome": ("outcome_missingness.csv", "missing_followup_n"),
        "villages": ("trial_reproduction.csv", "villages"),
        "intervention_villages": ("village_benefit_summary.csv", "W=1 village count"),
        "control_villages": ("village_benefit_summary.csv", "W=0 village count"),
        "intervention_participants": ("outcome_missingness.csv", "Intervention randomized_n"),
        "control_participants": ("outcome_missingness.csv", "Control randomized_n"),
    }
    for field, (source, source_field) in study_sources.items():
        targets.append(_target(f"study.{field}", "study", source, source_field, numeric=summary[field], page="1 Intervention Overview"))
    for field in ("estimate", "ci_lower", "ci_upper"):
        targets.append(_target(
            f"effect.{field}", "average_effect", "trial_reproduction.csv", field,
            numeric=summary[f"treatment_effect_{field}"], unit="percentage points", page="1 Intervention Overview",
        ))
    hte = tables["bi_hte_validation"]
    primary = hte[(hte["metric"].eq("AUTOC")) & (hte["normalization"].eq("within_fold"))]
    for row in primary.itertuples(index=False):
        targets.append(_target(
            f"hte.autoc.{row.model_or_comparison}", "hte", "hte_validation_summary.csv", "estimate",
            numeric=row.estimate, unit="AUTOC", page="3 Treatment Effect Heterogeneity",
        ))
    for row in hte[hte["metric"].eq("calibration_slope")].itertuples(index=False):
        targets.append(_target(
            f"hte.calibration.{row.model_or_comparison}", "hte", "calibration_summary.csv", "slope",
            numeric=row.estimate, unit="slope", page="3 Treatment Effect Heterogeneity",
        ))
    for row in hte[hte["metric"].eq("evidence_classification")].itertuples(index=False):
        targets.append(_target(
            f"hte.classification.{row.model_or_comparison}", "hte", "hte_evidence_classification.csv", "classification",
            text=row.classification, unit="classification", page="3 Treatment Effect Heterogeneity",
        ))
    for row in tables["bi_rollout_anchor"].itertuples(index=False):
        metrics = {
            "rollout_value": (row.point_population_rollout_value, "point_population_rollout_value", "percentage points"),
            "random_expected": (row.point_random_expected_value, "point_random_expected_value", "percentage points"),
            "gain_vs_random": (row.point_gain_vs_random, "point_gain_vs_random", "percentage points"),
            "value_ci_lower": (row.population_value_ci_lower, "population_value_ci_lower", "percentage points"),
            "value_ci_upper": (row.population_value_ci_upper, "population_value_ci_upper", "percentage points"),
            "gain_ci_lower": (row.gain_ci_lower, "gain_ci_lower", "percentage points"),
            "gain_ci_upper": (row.gain_ci_upper, "gain_ci_upper", "percentage points"),
        }
        for metric, (value, field, unit) in metrics.items():
            targets.append(_target(
                f"anchor.{row.policy}.K{row.capacity_villages}.{metric}", "rollout_anchor",
                "anchor_policy_uncertainty.csv", field, numeric=value, policy=row.policy,
                capacity=row.capacity_villages, unit=unit, page="4 Rollout Capacity",
            ))
        label_source = "capacity_advantage_labels.csv" if row.capacity_villages < 127 else "anchor_policy_uncertainty.csv"
        targets.append(_target(
            f"anchor.{row.policy}.K{row.capacity_villages}.capacity_label", "rollout_anchor",
            label_source, "capacity_advantage_label" if row.capacity_villages < 127 else "policy_vs_random_classification",
            text=row.capacity_advantage_label, policy=row.policy, capacity=row.capacity_villages,
            unit="classification", page="4 Rollout Capacity",
        ))
    targets.append(_target(
        "policy.final_conclusion", "final_conclusion", "final_phase11_conclusion.csv",
        "final_phase11_conclusion", text=summary["final_policy_conclusion"], unit="conclusion",
        page="4 Rollout Capacity; 5 Village Prioritization & Robustness",
    ))
    return pd.DataFrame(targets)


def write_powerbi_inputs(root: str | Path, output_root: str | Path | None = None) -> dict[str, Path]:
    """Write BI tables plus dictionary and reconciliation contract with stable bytes."""
    root = Path(root).resolve()
    output_root = Path(output_root).resolve() if output_root else root / "powerbi"
    data_dir = output_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    tables = build_powerbi_tables(root)
    written = {}
    for name, frame in tables.items():
        path = data_dir / f"{name}.csv"
        frame.to_csv(path, index=False, lineterminator="\n", float_format="%.17g")
        written[name] = path
    for name, frame in {
        "data_dictionary": build_data_dictionary(tables),
        "reconciliation_targets": build_reconciliation_targets(tables),
    }.items():
        path = output_root / f"{name}.csv"
        frame.to_csv(path, index=False, lineterminator="\n", float_format="%.17g")
        written[name] = path
    return written


if __name__ == "__main__":
    write_powerbi_inputs(Path.cwd())
