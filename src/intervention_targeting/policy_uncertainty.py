"""Village-bootstrap uncertainty for frozen Phase-10 rollout policies."""

from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

from intervention_targeting.hte_validation import EXPECTED_FOLD_HASH
from intervention_targeting.rollout_policy import (
    POLICY_PREFIXES,
    POLICY_SIGNALS,
    build_capacity_curve,
    build_priorities,
    load_phase10_inputs,
)


matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


BOOTSTRAP_REPLICATES = 2_000
BOOTSTRAP_SEED = 11_100
VILLAGE_COUNT = 127
EVALUATION_COUNT = 4_508
ANCHORS = (13, 32, 64, 95, 127)
INFERENCE_ANCHORS = (13, 32, 64, 95)
POLICIES = tuple(POLICY_SIGNALS)
PAIRS = (
    ("grf", "simple"),
    ("grf", "baseline_risk"),
    ("simple", "baseline_risk"),
)


def load_phase11a_inputs(
    root: str | Path,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load and reconcile frozen Phase-9/10 policy inputs and Phase-8 scores."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    villages, scores = load_phase10_inputs(root)
    priorities = pd.read_csv(derived / "policy_village_priorities.csv")
    curve = pd.read_csv(derived / "policy_capacity_curve.csv")
    expected_priorities = build_priorities(villages)
    expected_curve = build_capacity_curve(expected_priorities, scores)
    try:
        pd.testing.assert_frame_equal(
            priorities, expected_priorities, check_exact=False, rtol=1e-12, atol=1e-12
        )
        pd.testing.assert_frame_equal(
            curve, expected_curve, check_exact=False, rtol=1e-12, atol=1e-12
        )
    except AssertionError as error:
        raise ValueError("frozen Phase-10 policy artifacts changed") from error
    if villages.groupby("W").size().to_dict() != {0: 63, 1: 64}:
        raise ValueError("Phase-9 village treatment-arm counts changed")
    if len(scores) != EVALUATION_COUNT or scores["gamma_benefit"].isna().any():
        raise ValueError("Phase-8 evaluation population changed")
    return villages, priorities, curve, scores


def build_bootstrap_multiplicities(
    villages: pd.DataFrame,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
) -> pd.DataFrame:
    """Draw arm-stratified village multiplicities with one common replicate design."""
    ordered = villages.sort_values("village_id").reset_index(drop=True)
    if len(ordered) != VILLAGE_COUNT or not ordered["village_id"].is_unique:
        raise ValueError("bootstrap requires 127 unique source villages")
    if ordered.groupby("W").size().to_dict() != {0: 63, 1: 64}:
        raise ValueError("bootstrap requires 64 intervention and 63 control villages")
    if replicates < 1:
        raise ValueError("bootstrap replicate count must be positive")

    rng = np.random.default_rng(seed)
    counts = np.zeros((replicates, VILLAGE_COUNT), dtype=np.int16)
    for arm, draws_per_replicate in ((1, 64), (0, 63)):
        source = np.flatnonzero(ordered["W"].to_numpy() == arm)
        draws = rng.choice(source, size=(replicates, draws_per_replicate), replace=True)
        rows = np.repeat(np.arange(replicates), draws_per_replicate)
        np.add.at(counts, (rows, draws.ravel()), 1)
    result = pd.DataFrame(counts, columns=ordered["village_id"].to_numpy())
    result.index = np.arange(1, replicates + 1)
    result.index.name = "bootstrap_replicate"
    result.columns.name = "village_id"
    return result


def _village_evaluation(villages: pd.DataFrame, scores: pd.DataFrame) -> pd.DataFrame:
    if len(scores) != EVALUATION_COUNT or not scores["ID"].is_unique:
        raise ValueError("bootstrap evaluation requires 4,508 unique participants")
    if scores["gamma_benefit"].isna().any() or scores["village_id"].nunique() != VILLAGE_COUNT:
        raise ValueError("gamma benefit must be complete across all villages")
    gamma = (
        scores.groupby("village_id", sort=True)
        .agg(gamma_rows=("ID", "size"), gamma_sum=("gamma_benefit", "sum"))
        .reset_index()
    )
    evaluation = (
        villages[["village_id", "W", "n_evaluation"]]
        .merge(gamma, on="village_id", validate="one_to_one")
        .sort_values("village_id")
        .reset_index(drop=True)
    )
    if not evaluation["gamma_rows"].eq(evaluation["n_evaluation"]).all():
        raise ValueError("village gamma counts differ from Phase-9 evaluation counts")
    if evaluation["gamma_rows"].sum() != EVALUATION_COUNT:
        raise ValueError("bootstrap evaluation denominator changed")
    return evaluation


def bootstrap_policy_values(
    villages: pd.DataFrame,
    priorities: pd.DataFrame,
    scores: pd.DataFrame,
    multiplicities: pd.DataFrame,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], np.ndarray]:
    """Evaluate frozen policy memberships using common village multiplicities."""
    evaluation = _village_evaluation(villages, scores)
    village_ids = evaluation["village_id"].tolist()
    if multiplicities.columns.tolist() != village_ids:
        raise ValueError("bootstrap multiplicity columns do not match ordered villages")
    if (multiplicities.to_numpy() < 0).any():
        raise ValueError("bootstrap multiplicities cannot be negative")
    priority = evaluation[["village_id"]].merge(
        priorities[["village_id", *[f"{POLICY_PREFIXES[p]}_eval_rank" for p in POLICIES]]],
        on="village_id",
        validate="one_to_one",
    )
    if len(priority) != VILLAGE_COUNT:
        raise ValueError("policy membership join lost villages")

    weights = multiplicities.to_numpy(dtype=float)
    gamma_rows = evaluation["gamma_rows"].to_numpy(dtype=float)
    gamma_sum = evaluation["gamma_sum"].to_numpy(dtype=float)
    denominator = weights @ gamma_rows
    if (denominator <= 0).any():
        raise ValueError("bootstrap evaluation denominator must be positive")
    overall = (weights @ gamma_sum) / denominator
    capacities = np.arange(VILLAGE_COUNT + 1)
    random_expectation = overall[:, None] * capacities[None, :] / VILLAGE_COUNT

    values: dict[str, np.ndarray] = {}
    gains: dict[str, np.ndarray] = {}
    for policy in POLICIES:
        rank = priority[f"{POLICY_PREFIXES[policy]}_eval_rank"].to_numpy(dtype=int)
        if set(rank) != set(range(1, VILLAGE_COUNT + 1)):
            raise ValueError(f"{policy} policy ranks changed")
        selected = rank[:, None] <= capacities[None, :]
        numerator = weights @ (gamma_sum[:, None] * selected)
        policy_value = numerator / denominator[:, None]
        policy_value[:, 0] = 0.0
        policy_value[:, VILLAGE_COUNT] = overall
        gain = policy_value - random_expectation
        gain[:, 0] = 0.0
        gain[:, VILLAGE_COUNT] = 0.0
        values[policy] = policy_value
        gains[policy] = gain
    return values, gains, overall


def _interval(samples: np.ndarray) -> tuple[float, float]:
    lower, upper = np.percentile(samples, [2.5, 97.5])
    return float(lower), float(upper)


def _evidence_label(lower: float, upper: float) -> str:
    if lower > 0:
        return "CLEARLY POSITIVE"
    if upper < 0:
        return "CLEARLY NEGATIVE"
    return "INCONCLUSIVE"


def capacity_advantage_label(gain_ci_lower: float, pairwise_ci_lowers: list[float]) -> str:
    """Apply the prespecified strict capacity-specific advantage rule."""
    if gain_ci_lower > 0 and len(pairwise_ci_lowers) == 2 and all(
        lower > 0 for lower in pairwise_ci_lowers
    ):
        return "ROBUST CAPACITY-SPECIFIC ADVANTAGE"
    return "NO CLEAR CAPACITY-SPECIFIC ADVANTAGE"


def summarize_uncertainty(
    primary_curve: pd.DataFrame,
    values: dict[str, np.ndarray],
    gains: dict[str, np.ndarray],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Summarize pointwise curves, anchors, paired differences, and strict labels."""
    if set(values) != set(gains) or set(values) != set(POLICIES):
        raise ValueError("bootstrap policy set changed")
    if len(primary_curve) != len(POLICIES) * (VILLAGE_COUNT + 1):
        raise ValueError("primary Phase-10 curve grain changed")
    point = primary_curve.set_index(["policy", "capacity_villages"])
    rows = []
    for policy in POLICIES:
        if values[policy].shape[1] != VILLAGE_COUNT + 1 or gains[policy].shape != values[policy].shape:
            raise ValueError(f"{policy} bootstrap curve shape changed")
        for capacity in range(VILLAGE_COUNT + 1):
            value_lower, value_upper = _interval(values[policy][:, capacity])
            gain_lower, gain_upper = _interval(gains[policy][:, capacity])
            source = point.loc[policy, capacity]
            rows.append(
                {
                    "policy": policy,
                    "capacity_villages": capacity,
                    "point_population_rollout_value": source["population_rollout_value"],
                    "population_value_ci_lower": value_lower,
                    "population_value_ci_upper": value_upper,
                    "point_random_expected_value": source["random_expected_value"],
                    "point_gain_vs_random": source["value_gain_vs_random"],
                    "gain_ci_lower": gain_lower,
                    "gain_ci_upper": gain_upper,
                    "interval_type": "pointwise_95_percentile_bootstrap",
                    "bootstrap_replicates": values[policy].shape[0],
                }
            )
    uncertainty = pd.DataFrame(rows)
    anchors = uncertainty.loc[uncertainty["capacity_villages"].isin(ANCHORS)].copy()
    anchors["policy_vs_random_classification"] = anchors.apply(
        lambda row: "RECONCILIATION ENDPOINT"
        if row["capacity_villages"] == VILLAGE_COUNT
        else _evidence_label(row["gain_ci_lower"], row["gain_ci_upper"]),
        axis=1,
    )

    pairwise_rows = []
    for capacity in INFERENCE_ANCHORS:
        for left, right in PAIRS:
            samples = values[left][:, capacity] - values[right][:, capacity]
            lower, upper = _interval(samples)
            pairwise_rows.append(
                {
                    "capacity_villages": capacity,
                    "comparison": f"{left}_minus_{right}",
                    "policy_left": left,
                    "policy_right": right,
                    "point_difference": point.loc[left, capacity]["population_rollout_value"]
                    - point.loc[right, capacity]["population_rollout_value"],
                    "bootstrap_se": samples.std(ddof=1),
                    "ci_lower": lower,
                    "ci_upper": upper,
                    "difference_classification": _evidence_label(lower, upper),
                }
            )
    pairwise = pd.DataFrame(pairwise_rows)

    label_rows = []
    anchor_index = anchors.set_index(["policy", "capacity_villages"])
    for policy in POLICIES:
        for capacity in INFERENCE_ANCHORS:
            other_policies = [other for other in POLICIES if other != policy]
            oriented_lowers = [
                _interval(values[policy][:, capacity] - values[other][:, capacity])[0]
                for other in other_policies
            ]
            gain_lower = anchor_index.loc[policy, capacity]["gain_ci_lower"]
            label_rows.append(
                {
                    "policy": policy,
                    "capacity_villages": capacity,
                    "gain_ci_lower": gain_lower,
                    "minimum_pairwise_ci_lower": min(oriented_lowers),
                    "capacity_advantage_label": capacity_advantage_label(
                        gain_lower, oriented_lowers
                    ),
                }
            )
    labels = pd.DataFrame(label_rows)
    return uncertainty, anchors.reset_index(drop=True), pairwise, labels


def _bootstrap_metadata() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "bootstrap_replicates": BOOTSTRAP_REPLICATES,
                "bootstrap_seed": BOOTSTRAP_SEED,
                "bootstrap_unit": "village",
                "stratification": "randomized_treatment_arm_64_intervention_63_control",
                "weighting": "participant_weighted_with_village_multiplicity",
                "policy_condition": "frozen_phase10_memberships_no_reranking",
                "evaluation_population": EVALUATION_COUNT,
                "interval_method": "pointwise_percentile_2.5_97.5",
                "formal_inference_anchors": "13|32|64|95",
                "full_capacity_role": "reconciliation_only",
            }
        ]
    )


def _write_figures(curve: pd.DataFrame, value_path: Path, gain_path: Path) -> None:
    labels = {"grf": "GRF", "simple": "Simple HTE", "baseline_risk": "Baseline risk"}
    styles = {
        "grf": {"color": "#2F6B9A", "linestyle": "-"},
        "simple": {"color": "#D98E2B", "linestyle": "--"},
        "baseline_risk": {"color": "#7A8F3A", "linestyle": "-."},
    }
    value_path.parent.mkdir(parents=True, exist_ok=True)

    fig, axis = plt.subplots(figsize=(8, 5))
    for policy, group in curve.groupby("policy", sort=False):
        axis.fill_between(
            group["capacity_villages"],
            group["population_value_ci_lower"],
            group["population_value_ci_upper"],
            color=styles[policy]["color"],
            alpha=0.10,
            linewidth=0,
        )
        axis.plot(
            group["capacity_villages"],
            group["point_population_rollout_value"],
            label=labels[policy],
            linewidth=2,
            **styles[policy],
        )
    random = curve.loc[curve["policy"].eq("grf")]
    axis.plot(
        random["capacity_villages"],
        random["point_random_expected_value"],
        color="#4B5563",
        linestyle=":",
        linewidth=2,
        label="Uniform random expectation",
    )
    fig.suptitle("Policy value with village-bootstrap uncertainty", fontsize=13, y=0.98)
    axis.set_title(
        "Pointwise 95% intervals; B=2,000; conditional on frozen Phase-10 policies",
        fontsize=9,
        color="#4B5563",
        pad=10,
    )
    axis.set(xlabel="Villages selected", ylabel="Population rollout value (percentage points)")
    axis.grid(axis="y", color="#E5E7EB", linewidth=0.8)
    axis.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(value_path, dpi=160, metadata={"Software": "matplotlib"})
    plt.close(fig)

    fig, axis = plt.subplots(figsize=(8, 5))
    for policy, group in curve.groupby("policy", sort=False):
        axis.fill_between(
            group["capacity_villages"],
            group["gain_ci_lower"],
            group["gain_ci_upper"],
            color=styles[policy]["color"],
            alpha=0.10,
            linewidth=0,
        )
        axis.plot(
            group["capacity_villages"],
            group["point_gain_vs_random"],
            label=labels[policy],
            linewidth=2,
            **styles[policy],
        )
    axis.axhline(0, color="#4B5563", linewidth=1, linestyle=":")
    fig.suptitle("Policy gain versus random with village-bootstrap uncertainty", fontsize=13, y=0.98)
    axis.set_title(
        "Pointwise 95% intervals; formal interpretation restricted to K=13, 32, 64, and 95",
        fontsize=9,
        color="#4B5563",
        pad=10,
    )
    axis.set(xlabel="Villages selected", ylabel="Gain versus random (percentage points)")
    axis.grid(axis="y", color="#E5E7EB", linewidth=0.8)
    axis.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(gain_path, dpi=160, metadata={"Software": "matplotlib"})
    plt.close(fig)


def run_phase11a_pipeline(root: str | Path) -> dict[str, str]:
    """Run deterministic Phase-11A uncertainty and write compact summary artifacts."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    figures = root / "reports" / "figures"
    villages, priorities, primary_curve, scores = load_phase11a_inputs(root)
    multiplicities = build_bootstrap_multiplicities(villages)
    values, gains, _ = bootstrap_policy_values(villages, priorities, scores, multiplicities)
    uncertainty, anchors, pairwise, labels = summarize_uncertainty(
        primary_curve, values, gains
    )
    paths = {
        "uncertainty_curve": derived / "policy_uncertainty_curve.csv",
        "anchor_uncertainty": derived / "anchor_policy_uncertainty.csv",
        "pairwise_uncertainty": derived / "anchor_pairwise_uncertainty.csv",
        "advantage_labels": derived / "capacity_advantage_labels.csv",
        "bootstrap_metadata": derived / "policy_bootstrap_metadata.csv",
        "value_figure": figures / "policy_value_uncertainty.png",
        "gain_figure": figures / "policy_gain_uncertainty.png",
    }
    uncertainty.to_csv(paths["uncertainty_curve"], index=False)
    anchors.to_csv(paths["anchor_uncertainty"], index=False)
    pairwise.to_csv(paths["pairwise_uncertainty"], index=False)
    labels.to_csv(paths["advantage_labels"], index=False)
    _bootstrap_metadata().to_csv(paths["bootstrap_metadata"], index=False)
    _write_figures(uncertainty, paths["value_figure"], paths["gain_figure"])
    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = run_phase11a_pipeline(root)
    curve = pd.read_csv(paths["uncertainty_curve"])
    print(
        "Phase-11A policy uncertainty artifacts written: "
        f"rows={len(curve)}, bootstrap_replicates={BOOTSTRAP_REPLICATES}"
    )


if __name__ == "__main__":
    main()
