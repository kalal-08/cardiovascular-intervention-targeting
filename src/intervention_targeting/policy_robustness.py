"""Phase-11B robustness, influence, and descriptive equity analyses."""

from hashlib import sha256
from pathlib import Path

import numpy as np
import pandas as pd

from intervention_targeting.cohort import build_causal_cohort
from intervention_targeting.heterogeneity import MODERATOR_SPECS
from intervention_targeting.policy_uncertainty import (
    INFERENCE_ANCHORS,
    PAIRS,
    load_phase11a_inputs,
)
from intervention_targeting.rollout_policy import (
    ANCHOR_CAPACITIES,
    EVALUATION_COUNT,
    POLICY_PREFIXES,
    POLICY_SIGNALS,
    RANDOMIZED_COUNT,
    VILLAGE_COUNT,
    _stable_village_key,
)


RAW_POLICY_SIGNALS = dict(POLICY_SIGNALS)
POLICIES = tuple(POLICY_SIGNALS)
EQUITY_DIMENSIONS = ("age", "sex", "education", "occupation", "income")
RAW_JACCARD_SENSITIVITY_THRESHOLD = 0.5
EQUAL_VILLAGE_LABEL = "EQUAL-VILLAGE SENSITIVITY - NOT PRIMARY ESTIMAND"
FINAL_CONCLUSION = "NO SINGLE ROBUST POLICY WINNER ESTABLISHED"
PHASE11A_TABLES = (
    "policy_uncertainty_curve.csv",
    "anchor_policy_uncertainty.csv",
    "anchor_pairwise_uncertainty.csv",
    "capacity_advantage_labels.csv",
    "policy_bootstrap_metadata.csv",
)
PHASE11A_FIGURES = (
    "policy_value_uncertainty.png",
    "policy_gain_uncertainty.png",
)


def phase11a_hashes(root: str | Path) -> dict[str, str]:
    """Hash frozen Phase-11A tables and figures without regenerating them."""
    root = Path(root).resolve()
    paths = {
        **{name: root / "data" / "derived" / name for name in PHASE11A_TABLES},
        **{name: root / "reports" / "figures" / name for name in PHASE11A_FIGURES},
    }
    return {name: sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}


def load_phase11b_inputs(
    root: str | Path,
) -> tuple[pd.DataFrame, ...]:
    """Load and reconcile frozen policy, uncertainty, score, and cohort inputs."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    villages, priorities, primary_curve, scores = load_phase11a_inputs(root)

    cohort = pd.read_csv(derived / "causal_cohort.csv")
    expected_cohort = build_causal_cohort(root / "data" / "raw" / "smarter_anonymised_data.csv")
    try:
        pd.testing.assert_frame_equal(
            cohort,
            expected_cohort,
            check_dtype=False,
            check_exact=False,
            rtol=1e-12,
            atol=1e-12,
        )
    except AssertionError as error:
        raise ValueError("frozen Phase-3 causal cohort changed") from error

    anchor_uncertainty = pd.read_csv(derived / "anchor_policy_uncertainty.csv")
    pairwise_uncertainty = pd.read_csv(derived / "anchor_pairwise_uncertainty.csv")
    advantage_labels = pd.read_csv(derived / "capacity_advantage_labels.csv")
    metadata = pd.read_csv(derived / "policy_bootstrap_metadata.csv")
    if (
        len(cohort) != RANDOMIZED_COUNT
        or not cohort["ID"].is_unique
        or cohort["village_id"].nunique() != VILLAGE_COUNT
        or len(scores) != EVALUATION_COUNT
        or not scores["ID"].is_unique
    ):
        raise ValueError("Phase-11B population contract changed")
    if len(anchor_uncertainty) != 15 or len(pairwise_uncertainty) != 12:
        raise ValueError("Phase-11A anchor uncertainty grain changed")
    nonfull = anchor_uncertainty.loc[anchor_uncertainty["capacity_villages"].lt(VILLAGE_COUNT)]
    if set(nonfull["policy_vs_random_classification"]) != {"INCONCLUSIVE"}:
        raise ValueError("Phase-11A policy-vs-random checkpoint changed")
    if len(advantage_labels) != 12 or set(advantage_labels["capacity_advantage_label"]) != {
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    }:
        raise ValueError("Phase-11A capacity-specific advantage checkpoint changed")
    if len(metadata) != 1:
        raise ValueError("Phase-11A bootstrap metadata changed")
    design = metadata.iloc[0]
    if not (
        design["bootstrap_replicates"] == 2_000
        and design["bootstrap_seed"] == 11_100
        and design["bootstrap_unit"] == "village"
        and design["weighting"] == "participant_weighted_with_village_multiplicity"
        and design["policy_condition"] == "frozen_phase10_memberships_no_reranking"
    ):
        raise ValueError("Phase-11A bootstrap design changed")
    notable = pairwise_uncertainty.query(
        "capacity_villages == 95 and comparison == 'simple_minus_baseline_risk'"
    )
    if len(notable) != 1 or notable.iloc[0]["difference_classification"] != "CLEARLY POSITIVE":
        raise ValueError("Phase-11A simple-versus-risk K95 result changed")
    return (
        villages,
        priorities,
        primary_curve,
        scores,
        cohort,
        anchor_uncertainty,
        pairwise_uncertainty,
        advantage_labels,
    )


def build_raw_global_priorities(villages: pd.DataFrame) -> pd.DataFrame:
    """Rank original village signals globally with deterministic outcome-blind ties."""
    required = {"village_id", *RAW_POLICY_SIGNALS.values()}
    if required - set(villages.columns):
        raise ValueError("raw-ranking inputs are incomplete")
    if len(villages) != VILLAGE_COUNT or not villages["village_id"].is_unique:
        raise ValueError("raw ranking requires 127 unique villages")
    if villages[list(RAW_POLICY_SIGNALS.values())].isna().any().any():
        raise ValueError("raw village signals must be complete")

    result = villages[["village_id", *RAW_POLICY_SIGNALS.values()]].copy()
    result["_tie_key"] = result["village_id"].map(_stable_village_key)
    for policy, signal in RAW_POLICY_SIGNALS.items():
        rank = f"{POLICY_PREFIXES[policy]}_raw_global_rank"
        ordered = result.sort_values([signal, "_tie_key"], ascending=[False, True])
        result.loc[ordered.index, rank] = np.arange(1, VILLAGE_COUNT + 1)
        result[rank] = result[rank].astype(int)
    return result.drop(columns="_tie_key").sort_values("village_id").reset_index(drop=True)


def _direction(value: float, tolerance: float = 1e-12) -> int:
    return 0 if abs(value) <= tolerance else (1 if value > 0 else -1)


def _ordering(values: dict[str, float]) -> str:
    ordered = sorted(POLICIES, key=lambda policy: (-values[policy], POLICIES.index(policy)))
    groups: list[list[str]] = []
    for policy in ordered:
        if groups and np.isclose(values[policy], values[groups[-1][0]], rtol=0, atol=1e-12):
            groups[-1].append(policy)
        else:
            groups.append([policy])
    return ">".join("=".join(group) for group in groups)


def classify_raw_stability(
    primary_gains: list[float],
    raw_gains: list[float],
    primary_relations: list[str],
    raw_relations: list[str],
    jaccards: list[float],
) -> str:
    """Apply a fixed material-reversal rule to one policy's raw sensitivity."""
    sign_reversal = any(
        _direction(primary) * _direction(raw) < 0
        for primary, raw in zip(primary_gains, raw_gains, strict=True)
    )
    ordering_reversal = primary_relations != raw_relations
    large_set_instability = any(value < RAW_JACCARD_SENSITIVITY_THRESHOLD for value in jaccards)
    return "SENSITIVE" if sign_reversal or ordering_reversal or large_set_instability else "STABLE"


def _gamma_by_village(scores: pd.DataFrame) -> pd.DataFrame:
    if (
        len(scores) != EVALUATION_COUNT
        or not scores["ID"].is_unique
        or scores["village_id"].nunique() != VILLAGE_COUNT
        or scores["gamma_benefit"].isna().any()
    ):
        raise ValueError("gamma evaluation population changed")
    return (
        scores.groupby("village_id", sort=True)
        .agg(
            n_evaluation=("ID", "size"),
            gamma_benefit_sum=("gamma_benefit", "sum"),
            mean_gamma_benefit_j=("gamma_benefit", "mean"),
        )
        .reset_index()
    )


def _policy_relations(table: pd.DataFrame, value_column: str, policy: str) -> list[str]:
    indexed = table.set_index(["policy", "capacity_villages"])[value_column]
    relations = []
    for capacity in INFERENCE_ANCHORS:
        for other in POLICIES:
            if other != policy:
                relations.append(f"{other}:{_direction(indexed[policy, capacity] - indexed[other, capacity])}")
    return relations


def build_raw_ranking_robustness(
    villages: pd.DataFrame,
    priorities: pd.DataFrame,
    primary_curve: pd.DataFrame,
    scores: pd.DataFrame,
    raw_priorities: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Evaluate complete raw/global paths without changing primary memberships."""
    raw_priorities = (
        build_raw_global_priorities(villages) if raw_priorities is None else raw_priorities.copy()
    )
    expected = build_raw_global_priorities(villages)
    try:
        pd.testing.assert_frame_equal(raw_priorities, expected)
    except AssertionError as error:
        raise ValueError("raw priorities do not match the locked raw signals") from error
    gamma = _gamma_by_village(scores)
    rank_columns = [
        f"{POLICY_PREFIXES[policy]}_eval_rank" for policy in POLICIES
    ] + [f"{POLICY_PREFIXES[policy]}_raw_global_rank" for policy in POLICIES]
    evaluation = (
        priorities[["village_id", *rank_columns[:3]]]
        .merge(raw_priorities[["village_id", *rank_columns[3:]]], on="village_id", validate="one_to_one")
        .merge(gamma, on="village_id", validate="one_to_one")
    )
    if len(evaluation) != VILLAGE_COUNT or evaluation["n_evaluation"].sum() != EVALUATION_COUNT:
        raise ValueError("raw-ranking evaluation join changed population")
    primary = primary_curve.set_index(["policy", "capacity_villages"])
    overall = scores["gamma_benefit"].mean()
    rows = []
    for policy in POLICIES:
        prefix = POLICY_PREFIXES[policy]
        primary_rank = f"{prefix}_eval_rank"
        raw_rank = f"{prefix}_raw_global_rank"
        for capacity in range(VILLAGE_COUNT + 1):
            primary_set = set(evaluation.loc[evaluation[primary_rank].le(capacity), "village_id"])
            raw_set = set(evaluation.loc[evaluation[raw_rank].le(capacity), "village_id"])
            raw_value = (
                evaluation.loc[evaluation["village_id"].isin(raw_set), "gamma_benefit_sum"].sum()
                / EVALUATION_COUNT
            )
            if capacity == 0:
                raw_value = 0.0
            random_expected = capacity / VILLAGE_COUNT * overall
            if capacity == VILLAGE_COUNT:
                raw_value = random_expected = overall
            shared = len(primary_set & raw_set)
            union = len(primary_set | raw_set)
            source = primary.loc[policy, capacity]
            rows.append(
                {
                    "policy": policy,
                    "capacity_villages": capacity,
                    "primary_population_rollout_value": source["population_rollout_value"],
                    "primary_gain_vs_random": source["value_gain_vs_random"],
                    "raw_global_rollout_value": raw_value,
                    "raw_minus_primary_value": raw_value - source["population_rollout_value"],
                    "raw_ranking_gain_vs_random": raw_value - random_expected,
                    "shared_villages": shared,
                    "jaccard_overlap": shared / union if union else 1.0,
                }
            )
    result = pd.DataFrame(rows)
    primary_orders = {}
    raw_orders = {}
    for capacity, group in result.groupby("capacity_villages", sort=True):
        primary_orders[capacity] = _ordering(
            group.set_index("policy")["primary_population_rollout_value"].to_dict()
        )
        raw_orders[capacity] = _ordering(
            group.set_index("policy")["raw_global_rollout_value"].to_dict()
        )
    result["primary_policy_ordering"] = result["capacity_villages"].map(primary_orders)
    result["raw_policy_ordering"] = result["capacity_villages"].map(raw_orders)

    classifications = {}
    primary_behavior = result.rename(
        columns={"primary_population_rollout_value": "behavior_value"}
    )
    raw_behavior = result.rename(columns={"raw_global_rollout_value": "behavior_value"})
    for policy in POLICIES:
        formal = result.loc[
            result["policy"].eq(policy) & result["capacity_villages"].isin(INFERENCE_ANCHORS)
        ].sort_values("capacity_villages")
        classifications[policy] = classify_raw_stability(
            formal["primary_gain_vs_random"].tolist(),
            formal["raw_ranking_gain_vs_random"].tolist(),
            _policy_relations(primary_behavior, "behavior_value", policy),
            _policy_relations(raw_behavior, "behavior_value", policy),
            formal["jaccard_overlap"].tolist(),
        )
    result["raw_ranking_stability"] = result["policy"].map(classifications)
    return result


def _classify_behavior_consistency(
    primary_gains: list[float],
    alternative_gains: list[float],
    primary_relations: list[str],
    alternative_relations: list[str],
) -> str:
    sign_reversal = any(
        _direction(primary) * _direction(alternative) < 0
        for primary, alternative in zip(primary_gains, alternative_gains, strict=True)
    )
    return "DIFFERENT" if sign_reversal or primary_relations != alternative_relations else "CONSISTENT"


def build_equal_village_sensitivity(
    villages: pd.DataFrame,
    priorities: pd.DataFrame,
    primary_curve: pd.DataFrame,
    scores: pd.DataFrame,
) -> pd.DataFrame:
    """Evaluate frozen primary selections under equal-village weighting."""
    gamma = _gamma_by_village(scores)
    if len(gamma) != VILLAGE_COUNT or gamma["village_id"].nunique() != VILLAGE_COUNT:
        raise ValueError("equal-village sensitivity requires exactly 127 village means")
    evaluation = priorities.merge(gamma, on="village_id", validate="one_to_one")
    primary = primary_curve.set_index(["policy", "capacity_villages"])
    overall = gamma["mean_gamma_benefit_j"].mean()
    rows = []
    for policy in POLICIES:
        rank = f"{POLICY_PREFIXES[policy]}_eval_rank"
        for capacity in ANCHOR_CAPACITIES:
            selected = evaluation.loc[evaluation[rank].le(capacity), "mean_gamma_benefit_j"]
            value = selected.sum() / VILLAGE_COUNT
            random_expected = capacity / VILLAGE_COUNT * overall
            if capacity == VILLAGE_COUNT:
                value = random_expected = overall
            source = primary.loc[policy, capacity]
            rows.append(
                {
                    "policy": policy,
                    "capacity_villages": capacity,
                    "primary_participant_weighted_rollout_value": source["population_rollout_value"],
                    "primary_participant_weighted_gain_vs_random": source["value_gain_vs_random"],
                    "equal_village_rollout_value": value,
                    "equal_village_random_expected": random_expected,
                    "equal_village_gain_vs_random": value - random_expected,
                    "estimand_label": EQUAL_VILLAGE_LABEL,
                }
            )
    result = pd.DataFrame(rows)
    primary_orders = {}
    equal_orders = {}
    for capacity, group in result.groupby("capacity_villages", sort=True):
        primary_orders[capacity] = _ordering(
            group.set_index("policy")["primary_participant_weighted_rollout_value"].to_dict()
        )
        equal_orders[capacity] = _ordering(
            group.set_index("policy")["equal_village_rollout_value"].to_dict()
        )
    result["primary_policy_ordering"] = result["capacity_villages"].map(primary_orders)
    result["equal_village_policy_ordering"] = result["capacity_villages"].map(equal_orders)
    primary_behavior = result.rename(
        columns={"primary_participant_weighted_rollout_value": "behavior_value"}
    )
    equal_behavior = result.rename(columns={"equal_village_rollout_value": "behavior_value"})
    classifications = {}
    for policy in POLICIES:
        formal = result.loc[
            result["policy"].eq(policy) & result["capacity_villages"].isin(INFERENCE_ANCHORS)
        ].sort_values("capacity_villages")
        classifications[policy] = _classify_behavior_consistency(
            formal["primary_participant_weighted_gain_vs_random"].tolist(),
            formal["equal_village_gain_vs_random"].tolist(),
            _policy_relations(primary_behavior, "behavior_value", policy),
            _policy_relations(equal_behavior, "behavior_value", policy),
        )
    result["equal_village_consistency"] = result["policy"].map(classifications)
    return result


def has_sign_change(original: float, alternatives: np.ndarray) -> bool:
    """Return whether any deletion crosses or reaches zero from a nonzero point estimate."""
    sign = _direction(original)
    return sign != 0 and any(_direction(value) != sign for value in alternatives)


def build_village_influence(
    priorities: pd.DataFrame, scores: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Evaluate 127 fixed-membership leave-one-village-out deletions."""
    gamma = _gamma_by_village(scores)
    rank_columns = [f"{POLICY_PREFIXES[policy]}_eval_rank" for policy in POLICIES]
    evaluation = priorities[["village_id", *rank_columns]].merge(
        gamma, on="village_id", validate="one_to_one"
    )
    if len(evaluation) != VILLAGE_COUNT:
        raise ValueError("influence evaluation join lost villages")
    total_n = int(evaluation["n_evaluation"].sum())
    rows = []
    for capacity in INFERENCE_ANCHORS:
        totals = {}
        memberships = {}
        for policy in POLICIES:
            rank = f"{POLICY_PREFIXES[policy]}_eval_rank"
            memberships[policy] = evaluation[rank].le(capacity).to_numpy()
            totals[policy] = evaluation.loc[memberships[policy], "gamma_benefit_sum"].sum()
        for left, right in PAIRS:
            original = (totals[left] - totals[right]) / total_n
            for index, village in evaluation.iterrows():
                denominator = total_n - int(village["n_evaluation"])
                left_sum = totals[left] - (
                    village["gamma_benefit_sum"] if memberships[left][index] else 0.0
                )
                right_sum = totals[right] - (
                    village["gamma_benefit_sum"] if memberships[right][index] else 0.0
                )
                rows.append(
                    {
                        "capacity_villages": capacity,
                        "comparison": f"{left}_minus_{right}",
                        "policy_left": left,
                        "policy_right": right,
                        "deleted_village_id": int(village["village_id"]),
                        "original_difference": original,
                        "leave_one_village_out_difference": (left_sum - right_sum) / denominator,
                    }
                )
    deletions = pd.DataFrame(rows)
    summaries = []
    for keys, group in deletions.groupby(
        ["capacity_villages", "comparison", "policy_left", "policy_right"], sort=True
    ):
        capacity, comparison, left, right = keys
        original = group["original_difference"].iloc[0]
        changes = (group["leave_one_village_out_difference"] - original).abs()
        most = group.loc[changes.idxmax()]
        changed = has_sign_change(original, group["leave_one_village_out_difference"].to_numpy())
        summaries.append(
            {
                "capacity_villages": capacity,
                "comparison": comparison,
                "policy_left": left,
                "policy_right": right,
                "original_difference": original,
                "minimum_leave_one_village_out_difference": group[
                    "leave_one_village_out_difference"
                ].min(),
                "maximum_leave_one_village_out_difference": group[
                    "leave_one_village_out_difference"
                ].max(),
                "maximum_absolute_change": changes.max(),
                "any_sign_change": changed,
                "max_abs_change_village_id": int(most["deleted_village_id"]),
                "n_village_deletions": len(group),
                "influence_classification": (
                    "SENSITIVE TO SINGLE-VILLAGE DELETION"
                    if changed
                    else "ROBUST TO SINGLE-VILLAGE DELETION"
                ),
            }
        )
    return deletions, pd.DataFrame(summaries)


def _validate_equity_inputs(cohort: pd.DataFrame, priorities: pd.DataFrame) -> None:
    required = {
        "ID",
        "village_id",
        "age",
        "male",
        "education_high_above",
        "occupation_farmer",
        "Last_year_income_lt_10k",
        "risk0",
    }
    if required - set(cohort.columns):
        raise ValueError("equity cohort fields are incomplete")
    if (
        len(cohort) != RANDOMIZED_COUNT
        or not cohort["ID"].is_unique
        or cohort["village_id"].nunique() != VILLAGE_COUNT
        or len(priorities) != VILLAGE_COUNT
        or not priorities["village_id"].is_unique
    ):
        raise ValueError("equity population or village grain changed")
    if set(cohort["village_id"]) != set(priorities["village_id"]):
        raise ValueError("equity participant-to-village join is incomplete")
    for dimension in EQUITY_DIMENSIONS:
        spec = MODERATOR_SPECS[dimension]
        if spec["reconstruction_status"] != "VERIFIED":
            raise ValueError("equity dimensions must use verified Phase-6 mappings")


def build_equity_coverage_summary(
    cohort: pd.DataFrame, priorities: pd.DataFrame
) -> pd.DataFrame:
    """Describe whole-village coverage for five frozen baseline dimensions."""
    _validate_equity_inputs(cohort, priorities)
    rows = []
    for policy in POLICIES:
        rank = f"{POLICY_PREFIXES[policy]}_eval_rank"
        for capacity in ANCHOR_CAPACITIES:
            selected = set(priorities.loc[priorities[rank].le(capacity), "village_id"])
            covered = cohort["village_id"].isin(selected)
            overall_count = int(covered.sum())
            overall_coverage = overall_count / RANDOMIZED_COUNT
            for dimension in EQUITY_DIMENSIONS:
                spec = MODERATOR_SPECS[dimension]
                indicator = (
                    cohort["age"].ge(60).astype("int8")
                    if dimension == "age"
                    else cohort[spec["indicator"]]
                )
                if indicator.isna().any() or set(indicator.unique()) != {0, 1}:
                    raise ValueError(f"{dimension} equity mapping changed")
                for value, category in enumerate(spec["subgroup_labels"]):
                    subgroup = indicator.eq(value)
                    subgroup_total = int(subgroup.sum())
                    subgroup_covered = int((subgroup & covered).sum())
                    subgroup_coverage = subgroup_covered / subgroup_total
                    rows.append(
                        {
                            "policy": policy,
                            "capacity_villages": capacity,
                            "capacity_role": (
                                "endpoint_reconciliation"
                                if capacity == VILLAGE_COUNT
                                else "fixed_descriptive_anchor"
                            ),
                            "dimension": dimension,
                            "dimension_label": spec["label"],
                            "category": category,
                            "source_field": spec["raw_field"],
                            "source_definition": spec["source_definition"],
                            "mapping_status": spec["reconstruction_status"],
                            "n_subgroup_total": subgroup_total,
                            "n_subgroup_covered": subgroup_covered,
                            "subgroup_coverage": subgroup_coverage,
                            "n_overall_covered": overall_count,
                            "overall_randomized_coverage": overall_coverage,
                            "coverage_gap": subgroup_coverage - overall_coverage,
                            "analysis_label": "DESCRIPTIVE COVERAGE - NO FAIRNESS OPTIMIZATION",
                        }
                    )
    result = pd.DataFrame(rows)
    full = result.loc[result["capacity_villages"].eq(VILLAGE_COUNT)]
    if not (
        full["n_overall_covered"].eq(RANDOMIZED_COUNT).all()
        and np.allclose(full["subgroup_coverage"], 1)
        and np.allclose(full["overall_randomized_coverage"], 1)
        and np.allclose(full["coverage_gap"], 0, atol=1e-12)
    ):
        raise ValueError("K=127 equity coverage reconciliation failed")
    return result


def build_covered_baseline_risk_summary(
    cohort: pd.DataFrame, priorities: pd.DataFrame
) -> pd.DataFrame:
    """Describe baseline risk burden among participants in selected villages."""
    _validate_equity_inputs(cohort, priorities)
    if cohort["risk0"].isna().any():
        raise ValueError("baseline risk must be complete for covered-risk summary")
    overall = cohort["risk0"].mean()
    rows = []
    for policy in POLICIES:
        rank = f"{POLICY_PREFIXES[policy]}_eval_rank"
        for capacity in ANCHOR_CAPACITIES:
            selected = set(priorities.loc[priorities[rank].le(capacity), "village_id"])
            risk = cohort.loc[cohort["village_id"].isin(selected), "risk0"]
            rows.append(
                {
                    "policy": policy,
                    "capacity_villages": capacity,
                    "n_covered": len(risk),
                    "covered_mean_risk0": risk.mean(),
                    "covered_median_risk0": risk.median(),
                    "overall_randomized_mean_risk0": overall,
                    "covered_mean_minus_overall": risk.mean() - overall,
                    "analysis_label": "DESCRIPTIVE BASELINE RISK - NOT CAUSAL BENEFIT",
                }
            )
    result = pd.DataFrame(rows)
    full = result.loc[result["capacity_villages"].eq(VILLAGE_COUNT)]
    if not full["n_covered"].eq(RANDOMIZED_COUNT).all() or not np.allclose(
        full["covered_mean_minus_overall"], 0, atol=1e-12
    ):
        raise ValueError("K=127 covered-risk reconciliation failed")
    return result


def _oriented_pairwise_rows(
    pairwise: pd.DataFrame, policy: str, capacity: int
) -> list[dict[str, float | str]]:
    rows = []
    relevant = pairwise.loc[
        pairwise["capacity_villages"].eq(capacity)
        & (pairwise["policy_left"].eq(policy) | pairwise["policy_right"].eq(policy))
    ]
    for _, row in relevant.iterrows():
        if row["policy_left"] == policy:
            other = row["policy_right"]
            point, lower, upper = row["point_difference"], row["ci_lower"], row["ci_upper"]
        else:
            other = row["policy_left"]
            point, lower, upper = -row["point_difference"], -row["ci_upper"], -row["ci_lower"]
        label = "CLEARLY POSITIVE" if lower > 0 else ("CLEARLY NEGATIVE" if upper < 0 else "INCONCLUSIVE")
        rows.append(
            {
                "comparison": f"{policy}_minus_{other}",
                "point": point,
                "lower": lower,
                "upper": upper,
                "classification": label,
            }
        )
    return rows


def build_final_policy_robustness_summary(
    anchor_uncertainty: pd.DataFrame,
    pairwise_uncertainty: pd.DataFrame,
    advantage_labels: pd.DataFrame,
    raw_robustness: pd.DataFrame,
    equal_village: pd.DataFrame,
    influence: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Combine frozen Phase-11A inference with Phase-11B diagnostics."""
    nonfull = anchor_uncertainty.loc[
        anchor_uncertainty["capacity_villages"].isin(INFERENCE_ANCHORS)
    ].copy()
    if set(nonfull["policy_vs_random_classification"]) != {"INCONCLUSIVE"}:
        raise ValueError("final synthesis cannot alter the Phase-11A gain gate")
    if set(advantage_labels["capacity_advantage_label"]) != {
        "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"
    }:
        raise ValueError("final synthesis requires the locked negative capacity gate")
    labels = advantage_labels.set_index(["policy", "capacity_villages"])
    raw_classes = raw_robustness.groupby("policy")["raw_ranking_stability"].first()
    equal_classes = equal_village.groupby("policy")["equal_village_consistency"].first()
    rows = []
    for _, source in nonfull.sort_values(["policy", "capacity_villages"]).iterrows():
        policy = source["policy"]
        capacity = int(source["capacity_villages"])
        paired = _oriented_pairwise_rows(pairwise_uncertainty, policy, capacity)
        related_influence = influence.loc[
            influence["capacity_villages"].eq(capacity)
            & (influence["policy_left"].eq(policy) | influence["policy_right"].eq(policy))
        ]
        influence_label = (
            "SENSITIVE TO SINGLE-VILLAGE DELETION"
            if related_influence["any_sign_change"].any()
            else "ROBUST TO SINGLE-VILLAGE DELETION"
        )
        paired_text = " | ".join(
            f"{row['comparison']}: {row['point']:.6f} "
            f"[{row['lower']:.6f}, {row['upper']:.6f}] ({row['classification']})"
            for row in paired
        )
        rows.append(
            {
                "policy": policy,
                "capacity_villages": capacity,
                "phase10_point_rollout_value": source["point_population_rollout_value"],
                "phase11a_point_gain_vs_random": source["point_gain_vs_random"],
                "phase11a_gain_ci_lower": source["gain_ci_lower"],
                "phase11a_gain_ci_upper": source["gain_ci_upper"],
                "phase11a_gain_classification": source["policy_vs_random_classification"],
                "phase11a_paired_policy_results": paired_text,
                "phase11a_capacity_advantage_label": labels.loc[
                    policy, capacity
                ]["capacity_advantage_label"],
                "raw_ranking_stability": raw_classes[policy],
                "equal_village_consistency": equal_classes[policy],
                "single_village_influence": influence_label,
            }
        )
    summary = pd.DataFrame(rows)
    notable = pairwise_uncertainty.query(
        "capacity_villages == 95 and comparison == 'simple_minus_baseline_risk'"
    ).iloc[0]
    conclusion = pd.DataFrame(
        [
            {
                "final_phase11_conclusion": FINAL_CONCLUSION,
                "global_winner_established": False,
                "strict_global_rule": (
                    "same policy requires robust capacity-specific advantage at K=13|32|64|95"
                ),
                "all_policy_vs_random_gains_inconclusive": True,
                "all_capacity_specific_advantage_labels_negative": True,
                "notable_paired_comparison": "simple_minus_baseline_risk_at_K95",
                "notable_pairwise_point": notable["point_difference"],
                "notable_pairwise_ci_lower": notable["ci_lower"],
                "notable_pairwise_ci_upper": notable["ci_upper"],
                "notable_pairwise_classification": notable["difference_classification"],
                "notable_result_is_capacity_specific_advantage": False,
            }
        ]
    )
    return summary, conclusion


def run_phase11b_pipeline(root: str | Path) -> dict[str, str]:
    """Write deterministic Phase-11B aggregate outputs while protecting Phase 11A."""
    root = Path(root).resolve()
    before = phase11a_hashes(root)
    (
        villages,
        priorities,
        primary_curve,
        scores,
        cohort,
        anchor_uncertainty,
        pairwise_uncertainty,
        advantage_labels,
    ) = load_phase11b_inputs(root)
    raw_priorities = build_raw_global_priorities(villages)
    raw = build_raw_ranking_robustness(
        villages, priorities, primary_curve, scores, raw_priorities
    )
    equal = build_equal_village_sensitivity(villages, priorities, primary_curve, scores)
    _, influence = build_village_influence(priorities, scores)
    equity = build_equity_coverage_summary(cohort, priorities)
    covered_risk = build_covered_baseline_risk_summary(cohort, priorities)
    final_summary, conclusion = build_final_policy_robustness_summary(
        anchor_uncertainty,
        pairwise_uncertainty,
        advantage_labels,
        raw,
        equal,
        influence,
    )
    derived = root / "data" / "derived"
    paths = {
        "raw_ranking_robustness": derived / "raw_ranking_robustness.csv",
        "equal_village_sensitivity": derived / "equal_village_sensitivity.csv",
        "village_influence_summary": derived / "village_influence_summary.csv",
        "equity_coverage_summary": derived / "equity_coverage_summary.csv",
        "covered_baseline_risk_summary": derived / "covered_baseline_risk_summary.csv",
        "final_policy_robustness_summary": derived / "final_policy_robustness_summary.csv",
        "final_phase11_conclusion": derived / "final_phase11_conclusion.csv",
    }
    for table, path in zip(
        (raw, equal, influence, equity, covered_risk, final_summary, conclusion),
        paths.values(),
        strict=True,
    ):
        table.to_csv(path, index=False)
    if phase11a_hashes(root) != before:
        raise ValueError("Phase-11A outputs changed during Phase 11B")
    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = run_phase11b_pipeline(root)
    conclusion = pd.read_csv(paths["final_phase11_conclusion"]).iloc[0]
    print(f"Phase-11B artifacts written: {conclusion['final_phase11_conclusion']}")


if __name__ == "__main__":
    main()
