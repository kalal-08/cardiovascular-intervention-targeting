"""Public aggregate exceptions must never expose raw or participant-level files."""

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_exact_aggregate_exceptions_and_private_outputs():
    public = (
        "trial_reproduction", "baseline_balance", "classical_interactions",
        "classical_subgroup_effects", "hte_validation_summary", "calibration_summary",
        "anchor_policy_uncertainty", "final_policy_robustness_summary",
    )
    paths = [f"data/derived/{name}.csv" for name in public]
    private = [
        "data/raw/smarter_anonymised_data.csv", "data/derived/causal_cohort.csv",
        "data/derived/hte_model_matrix.csv", "data/derived/hte_evaluation_scores.csv",
        "data/derived/unapproved_new_export.csv", "renv/library/package/file",
        "powerbi/private.pbix", "powerbi/private.SemanticModel/definition/model.tmdl",
    ]
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-z", "--stdin"], cwd=ROOT,
        input="\0".join(paths + private).encode() + b"\0", capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert set(result.stdout.decode().rstrip("\0").split("\0")) == set(private)
