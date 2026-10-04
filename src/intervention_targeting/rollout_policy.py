"""Whole-village rollout-policy analytics for frozen SMARTER signals."""

from hashlib import sha256
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from intervention_targeting.hte_validation import EXPECTED_FOLD_HASH
from intervention_targeting.village_aggregation import aggregate_villages, load_phase9_inputs


POLICY_SIGNALS = {
    "grf": "mean_benefit_grf_oov",
    "simple": "mean_benefit_simple_oov",
    "baseline_risk": "mean_risk0",
}
POLICY_PREFIXES = {"grf": "grf", "simple": "simple", "baseline_risk": "risk"}
ANCHOR_CAPACITIES = (13, 32, 64, 95, 127)
OVERALL_GAMMA_BENEFIT = 1.8640556239554662
VILLAGE_COUNT = 127
RANDOMIZED_COUNT = 4_533
EVALUATION_COUNT = 4_508


def load_phase10_inputs(root: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load and reconcile the frozen Phase-9 village table and Phase-8 scores."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    predictions, scores = load_phase9_inputs(root)
    frozen = pd.read_csv(derived / "village_benefit_summary.csv")
    current = aggregate_villages(predictions, scores)
    try:
        pd.testing.assert_frame_equal(frozen, current, check_exact=False, rtol=1e-12, atol=1e-12)
    except AssertionError as error:
        raise ValueError("Phase-9 village aggregation changed") from error
    if (
        len(frozen) != VILLAGE_COUNT
        or not frozen["village_id"].is_unique
        or frozen["n_randomized"].sum() != RANDOMIZED_COUNT
        or frozen["n_evaluation"].sum() != EVALUATION_COUNT
        or frozen["n_missing_primary_outcome"].sum() != 25
    ):
        raise ValueError("Phase-9 village population contract changed")
    if len(scores) != EVALUATION_COUNT or scores["gamma_benefit"].isna().any():
        raise ValueError("Phase-8 gamma evaluation population changed")
    if not np.isclose(scores["gamma_benefit"].mean(), OVERALL_GAMMA_BENEFIT):
        raise ValueError("Phase-8 overall gamma benefit changed")
    return frozen, scores


def _stable_village_key(village_id: object) -> str:
    return sha256(f"village:{village_id}".encode()).hexdigest()


def build_priorities(villages: pd.DataFrame) -> pd.DataFrame:
    """Create deterministic fold-normalized policy priorities and global evaluation ranks."""
    required = {
        "village_id",
        "fold",
        "n_randomized",
        "n_evaluation",
        "n_missing_primary_outcome",
        *POLICY_SIGNALS.values(),
    }
    if required - set(villages.columns):
        raise ValueError("village priority inputs are incomplete")
    if len(villages) != VILLAGE_COUNT or not villages["village_id"].is_unique:
        raise ValueError("priorities require 127 unique villages")
    if villages[list(POLICY_SIGNALS.values())].isna().any().any():
        raise ValueError("candidate village signals must be complete")

    columns = [
        "village_id",
        "fold",
        "n_randomized",
        "n_evaluation",
        "n_missing_primary_outcome",
        *POLICY_SIGNALS.values(),
    ]
    result = villages[columns].copy()
    result["_tie_key"] = result["village_id"].map(_stable_village_key)
    for policy, signal in POLICY_SIGNALS.items():
        prefix = POLICY_PREFIXES[policy]
        percentile = f"{prefix}_priority_percentile"
        rank = f"{prefix}_eval_rank"
        result[percentile] = np.nan
        for _, group in result.groupby("fold", sort=True):
            ordered = group.sort_values([signal, "_tie_key"], ascending=[True, True])
            result.loc[ordered.index, percentile] = np.arange(1, len(ordered) + 1) / len(ordered)
        evaluation_order = result.sort_values([percentile, "_tie_key"], ascending=[False, True])
        result.loc[evaluation_order.index, rank] = np.arange(1, VILLAGE_COUNT + 1)
        result[rank] = result[rank].astype(int)
    return result.drop(columns="_tie_key").sort_values("village_id").reset_index(drop=True)


def build_capacity_curve(priorities: pd.DataFrame, scores: pd.DataFrame) -> pd.DataFrame:
    """Evaluate all three policies at every whole-village capacity from 0 to 127."""
    if len(scores) != EVALUATION_COUNT or not scores["ID"].is_unique:
        raise ValueError("policy evaluation requires 4,508 unique gamma rows")
    if scores["gamma_benefit"].isna().any() or scores["village_id"].nunique() != VILLAGE_COUNT:
        raise ValueError("gamma evaluation scores must be complete across 127 villages")
    gamma = (
        scores.groupby("village_id", sort=True)
        .agg(gamma_rows=("ID", "size"), gamma_benefit_sum=("gamma_benefit", "sum"))
        .reset_index()
    )
    evaluation = priorities.merge(gamma, on="village_id", validate="one_to_one")
    if not evaluation["gamma_rows"].eq(evaluation["n_evaluation"]).all():
        raise ValueError("village gamma counts differ from Phase-9 evaluation counts")

    overall = float(scores["gamma_benefit"].mean())
    rows: list[dict[str, float | int | str]] = []
    for policy in POLICY_SIGNALS:
        rank = f"{POLICY_PREFIXES[policy]}_eval_rank"
        ordered = evaluation.sort_values(rank)
        if ordered[rank].tolist() != list(range(1, VILLAGE_COUNT + 1)):
            raise ValueError(f"{policy} ranks must be exactly 1..127")
        randomized = np.r_[0, ordered["n_randomized"].to_numpy(int).cumsum()]
        eligible = np.r_[0, ordered["gamma_rows"].to_numpy(int).cumsum()]
        gamma_sum = np.r_[0.0, ordered["gamma_benefit_sum"].to_numpy(float).cumsum()]
        for capacity in range(VILLAGE_COUNT + 1):
            mean_selected = gamma_sum[capacity] / eligible[capacity] if capacity else 0.0
            value = gamma_sum[capacity] / EVALUATION_COUNT
            random_value = capacity / VILLAGE_COUNT * overall
            if capacity == VILLAGE_COUNT:
                mean_selected = value = random_value = overall
            rows.append(
                {
                    "policy": policy,
                    "capacity_villages": capacity,
                    "capacity_share_villages": capacity / VILLAGE_COUNT,
                    "selected_villages": capacity,
                    "n_selected_randomized": int(randomized[capacity]),
                    "randomized_coverage": randomized[capacity] / RANDOMIZED_COUNT,
                    "n_selected_evaluation": int(eligible[capacity]),
                    "evaluation_coverage": eligible[capacity] / EVALUATION_COUNT,
                    "selected_mean_gamma_benefit": mean_selected,
                    "population_rollout_value": value,
                    "random_expected_value": random_value,
                    "value_gain_vs_random": value - random_value,
                }
            )
    curve = pd.DataFrame(rows)
    full = curve.loc[curve["capacity_villages"].eq(VILLAGE_COUNT)]
    zero = curve.loc[curve["capacity_villages"].eq(0)]
    if not zero[["n_selected_randomized", "n_selected_evaluation", "population_rollout_value", "value_gain_vs_random"]].eq(0).all().all():
        raise ValueError("K=0 policy reconciliation failed")
    if not (
        full["n_selected_randomized"].eq(RANDOMIZED_COUNT).all()
        and full["n_selected_evaluation"].eq(EVALUATION_COUNT).all()
        and np.allclose(full["population_rollout_value"], overall)
        and np.allclose(full["value_gain_vs_random"], 0, atol=1e-12)
    ):
        raise ValueError("K=127 policy convergence failed")
    return curve


def build_anchor_summary(curve: pd.DataFrame) -> pd.DataFrame:
    """Return the predeclared communication capacities only."""
    anchors = curve.loc[curve["capacity_villages"].isin(ANCHOR_CAPACITIES)].copy()
    if len(anchors) != len(POLICY_SIGNALS) * len(ANCHOR_CAPACITIES):
        raise ValueError("anchor summary must contain 15 policy-capacity rows")
    return anchors.reset_index(drop=True)


def build_anchor_comparisons(
    curve: pd.DataFrame, priorities: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build point differences and set overlap at fixed capacities."""
    pairs = (
        ("grf", "simple"),
        ("grf", "baseline_risk"),
        ("simple", "baseline_risk"),
    )
    values = curve.set_index(["policy", "capacity_villages"])["population_rollout_value"]
    difference_rows = []
    overlap_rows = []
    for capacity in ANCHOR_CAPACITIES:
        for left, right in pairs:
            left_rank = f"{POLICY_PREFIXES[left]}_eval_rank"
            right_rank = f"{POLICY_PREFIXES[right]}_eval_rank"
            left_set = set(priorities.loc[priorities[left_rank].le(capacity), "village_id"])
            right_set = set(priorities.loc[priorities[right_rank].le(capacity), "village_id"])
            shared = len(left_set & right_set)
            difference_rows.append(
                {
                    "capacity_villages": capacity,
                    "comparison": f"{left}_minus_{right}",
                    "policy_left": left,
                    "policy_right": right,
                    "population_rollout_value_difference": values[left, capacity]
                    - values[right, capacity],
                }
            )
            overlap_rows.append(
                {
                    "capacity_villages": capacity,
                    "comparison": f"{left}_vs_{right}",
                    "policy_left": left,
                    "policy_right": right,
                    "shared_villages": shared,
                    "jaccard_overlap": shared / len(left_set | right_set),
                }
            )
    return pd.DataFrame(difference_rows), pd.DataFrame(overlap_rows)


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
        axis.plot(
            group["capacity_villages"],
            group["population_rollout_value"],
            label=labels[policy],
            linewidth=2,
            **styles[policy],
        )
    random = curve.loc[curve["policy"].eq("grf")]
    axis.plot(
        random["capacity_villages"],
        random["random_expected_value"],
        color="#4B5563",
        linestyle=":",
        linewidth=2,
        label="Uniform random expectation",
    )
    fig.suptitle("Population rollout value by whole-village capacity", fontsize=13, y=0.98)
    axis.set_title(
        "Retrospective evaluation; 127 villages and 4,508 outcome-observed participants",
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
        axis.plot(
            group["capacity_villages"],
            group["value_gain_vs_random"],
            label=labels[policy],
            linewidth=2,
            **styles[policy],
        )
    axis.axhline(0, color="#4B5563", linewidth=1, linestyle=":")
    fig.suptitle("Policy value above uniform random expectation", fontsize=13, y=0.98)
    axis.set_title(
        "Point estimates only; uncertainty and robustness are deferred to Phase 11",
        fontsize=9,
        color="#4B5563",
        pad=10,
    )
    axis.set(xlabel="Villages selected", ylabel="Value gain versus random (percentage points)")
    axis.grid(axis="y", color="#E5E7EB", linewidth=0.8)
    axis.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(gain_path, dpi=160, metadata={"Software": "matplotlib"})
    plt.close(fig)


def run_phase10_pipeline(root: str | Path) -> dict[str, str]:
    """Write deterministic Phase-10 policy tables and two compact figures."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    figure_dir = root / "reports" / "figures"
    villages, scores = load_phase10_inputs(root)
    priorities = build_priorities(villages)
    curve = build_capacity_curve(priorities, scores)
    anchors = build_anchor_summary(curve)
    differences, overlap = build_anchor_comparisons(curve, priorities)
    paths = {
        "priorities": derived / "policy_village_priorities.csv",
        "curve": derived / "policy_capacity_curve.csv",
        "anchors": derived / "policy_anchor_summary.csv",
        "differences": derived / "policy_anchor_differences.csv",
        "overlap": derived / "policy_anchor_overlap.csv",
        "value_figure": figure_dir / "rollout_capacity_value.png",
        "gain_figure": figure_dir / "rollout_gain_vs_random.png",
    }
    priorities.to_csv(paths["priorities"], index=False)
    curve.to_csv(paths["curve"], index=False)
    anchors.to_csv(paths["anchors"], index=False)
    differences.to_csv(paths["differences"], index=False)
    overlap.to_csv(paths["overlap"], index=False)
    _write_figures(curve, paths["value_figure"], paths["gain_figure"])
    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = run_phase10_pipeline(root)
    curve = pd.read_csv(paths["curve"])
    print(f"Phase-10 rollout policy artifacts written: rows={len(curve)}, policies=3, capacities=128")


if __name__ == "__main__":
    main()
