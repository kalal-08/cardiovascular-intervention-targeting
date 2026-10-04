"""Cluster-aware Phase 7 input, fold, and OOV prediction contracts."""

from collections import defaultdict
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess

import numpy as np
import pandas as pd

from intervention_targeting.cohort import (
    DESIGN_COLUMNS,
    HTE_FEATURE_ALLOWLIST,
    HTE_FEATURE_DENYLIST,
    build_causal_cohort,
)
from intervention_targeting.heterogeneity import (
    SIMPLE_HTE_FORMULA,
    SIMPLE_INTERACTION_TERMS,
    fit_simple_hte_benchmark,
    prepare_analysis_frame,
)


FOLD_COUNT = 5
GRF_TREES = 2_000
GRF_BASE_SEED = 7_300
MODEL_SPECIFICATION_ID = "grf_clustered_oov_v1"
SIMPLE_SPECIFICATION_ID = "phase6_simple_hte_oov_v1"

# One allowed baseline field has one missing value. Excluding it before any fit
# preserves the complete randomized prediction population without inventing an
# imputation rule or using outcome information.
HTE_FEATURE_COLUMNS = tuple(
    feature for feature in HTE_FEATURE_ALLOWLIST if feature != "risk_lifetime_0"
) + tuple(DESIGN_COLUMNS)


def build_feature_manifest() -> pd.DataFrame:
    """Describe the frozen complete-case numeric feature matrix."""
    rows = []
    for feature in HTE_FEATURE_COLUMNS:
        design = feature in DESIGN_COLUMNS
        rows.append(
            {
                "feature": feature,
                "source_field": feature,
                "timing": "pretreatment_design" if design else "pretreatment_baseline",
                "encoding": "numeric_raw_or_binary_code",
                "role": "design_factor" if design else "hte_predictor",
                "included_in_grf": 1,
                "notes": (
                    "village-constant minimisation factor"
                    if design
                    else "Phase-3 HTE allowlist"
                ),
            }
        )
    return pd.DataFrame(rows)


def _village_source(cohort: pd.DataFrame) -> pd.DataFrame:
    required = {"ID", "village_id", "W", *DESIGN_COLUMNS}
    missing = sorted(required - set(cohort.columns))
    if missing:
        raise ValueError(f"cohort missing fold fields: {missing}")
    if len(cohort) != 4_533 or cohort["village_id"].nunique() != 127:
        raise ValueError("fold construction requires all 4533 participants and 127 villages")
    constant = cohort.groupby("village_id")[["W", *DESIGN_COLUMNS]].nunique()
    if not constant.le(1).all().all():
        raise ValueError("treatment and design factors must be village-constant")
    aggregations = {
        "W": ("W", "first"),
        "participant_count": ("ID", "size"),
        **{column: (column, "first") for column in DESIGN_COLUMNS},
    }
    return cohort.groupby("village_id", sort=True).agg(**aggregations).reset_index()


def build_village_folds(cohort: pd.DataFrame) -> pd.DataFrame:
    """Assign five deterministic outcome-blind folds to intact villages."""
    villages = _village_source(cohort)
    folds = range(1, FOLD_COUNT + 1)
    assignments: dict[int, int] = {}
    signature_counts: defaultdict[tuple, int] = defaultdict(int)
    arm_counts: defaultdict[tuple, int] = defaultdict(int)
    participant_counts: defaultdict[int, int] = defaultdict(int)
    village_counts: defaultdict[int, int] = defaultdict(int)
    signature_columns = ["W", *DESIGN_COLUMNS]

    for signature, group in villages.groupby(signature_columns, sort=True):
        signature = tuple(int(value) for value in signature)
        ordered = group.sort_values(
            ["participant_count", "village_id"], ascending=[False, True]
        )
        for row in ordered.itertuples(index=False):
            fold = min(
                folds,
                key=lambda candidate: (
                    signature_counts[(signature, candidate)],
                    arm_counts[(int(row.W), candidate)],
                    participant_counts[candidate],
                    village_counts[candidate],
                    candidate,
                ),
            )
            assignments[int(row.village_id)] = fold
            signature_counts[(signature, fold)] += 1
            arm_counts[(int(row.W), fold)] += 1
            participant_counts[fold] += int(row.participant_count)
            village_counts[fold] += 1

    villages["fold"] = villages["village_id"].map(assignments).astype("int8")
    outcome_counts = (
        cohort.groupby("village_id")["primary_outcome_observed"].sum().astype(int)
        if "primary_outcome_observed" in cohort
        else pd.Series(0, index=villages["village_id"])
    )
    villages["outcome_observed_count"] = villages["village_id"].map(outcome_counts).astype(int)
    columns = [
        "village_id",
        "fold",
        "W",
        "participant_count",
        "outcome_observed_count",
        *DESIGN_COLUMNS,
    ]
    result = villages[columns].sort_values("village_id").reset_index(drop=True)
    validate_village_folds(cohort, result)
    return result


def validate_village_folds(cohort: pd.DataFrame, folds: pd.DataFrame) -> None:
    """Reject incomplete, split, or single-arm village folds."""
    required = {"village_id", "fold", "W"}
    if required - set(folds.columns):
        raise ValueError("fold map missing required columns")
    if len(folds) != 127 or not folds["village_id"].is_unique:
        raise ValueError("fold map must contain 127 unique villages")
    if set(folds["fold"]) != set(range(1, FOLD_COUNT + 1)):
        raise ValueError("fold map must contain exactly five folds")
    if folds.groupby("fold")["W"].nunique().ne(2).any():
        raise ValueError("every fold must contain both treatment arms")
    inherited = cohort[["village_id", "W"]].merge(
        folds[["village_id", "fold", "W"]],
        on="village_id",
        suffixes=("_cohort", "_fold"),
        validate="many_to_one",
    )
    if len(inherited) != len(cohort):
        raise ValueError("some participants lack a fold assignment")
    if not inherited["W_cohort"].eq(inherited["W_fold"]).all():
        raise ValueError("fold treatment coding differs from cohort")
    if inherited.groupby("village_id")["fold"].nunique().ne(1).any():
        raise ValueError("a village was split across folds")


def build_model_matrix(cohort: pd.DataFrame, folds: pd.DataFrame) -> pd.DataFrame:
    """Build the deterministic participant-level Python-to-R contract."""
    validate_village_folds(cohort, folds)
    if set(HTE_FEATURE_COLUMNS) & set(HTE_FEATURE_DENYLIST):
        raise ValueError("frozen feature set intersects the leakage denylist")
    if cohort[list(HTE_FEATURE_COLUMNS)].isna().any().any():
        raise ValueError("frozen Phase-7 features must be complete")
    if not all(pd.api.types.is_numeric_dtype(cohort[name]) for name in HTE_FEATURE_COLUMNS):
        raise ValueError("GRF features must be numeric")

    matrix = cohort.merge(
        folds[["village_id", "fold"]], on="village_id", validate="many_to_one"
    )
    matrix["outcome_observed"] = matrix["primary_outcome_observed"].astype("int8")
    columns = [
        "ID",
        "village_id",
        "fold",
        "W",
        "outcome_observed",
        "delta_risk",
        *HTE_FEATURE_COLUMNS,
    ]
    matrix = matrix[columns].sort_values("ID").reset_index(drop=True)
    if len(matrix) != 4_533 or not matrix["ID"].is_unique:
        raise ValueError("model matrix must contain one row per randomized participant")
    if int(matrix["outcome_observed"].sum()) != 4_508:
        raise ValueError("training eligibility differs from the locked outcome population")
    observed = matrix["outcome_observed"].eq(1)
    if matrix.loc[observed, "delta_risk"].isna().any():
        raise ValueError("observed-outcome training rows require delta_risk")
    if matrix.loc[~observed, "delta_risk"].notna().any():
        raise ValueError("missing outcomes cannot receive fabricated delta_risk")
    return matrix


def _prediction_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["age_ge_60"] = frame["age"].ge(60).astype("int8")
    frame["risk_ge_16"] = frame["risk0"].ge(16).astype("int8")
    return frame


def crossfit_simple_benchmark(
    cohort: pd.DataFrame, folds: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Cross-fit the frozen Phase-6 model using fixed effects for unseen villages."""
    validate_village_folds(cohort, folds)
    observed = prepare_analysis_frame(cohort).merge(
        folds[["village_id", "fold"]], on="village_id", validate="many_to_one"
    )
    prediction_frame = _prediction_indicators(cohort).merge(
        folds[["village_id", "fold"]], on="village_id", validate="many_to_one"
    )
    prediction_rows = []
    audit_rows = []
    for fold in range(1, FOLD_COUNT + 1):
        train = observed.loc[observed["fold"] != fold]
        heldout = prediction_frame.loc[prediction_frame["fold"] == fold].copy()
        training_villages = set(train["village_id"])
        heldout_villages = set(heldout["village_id"])
        overlap = training_villages & heldout_villages
        if overlap:
            raise ValueError(f"simple benchmark village leakage in fold {fold}")
        fit = fit_simple_hte_benchmark(train)
        if not fit.converged or fit.model.formula != SIMPLE_HTE_FORMULA:
            raise ValueError(f"simple benchmark failed in fold {fold}")
        tau = np.full(len(heldout), float(fit.params["W"]))
        for term in SIMPLE_INTERACTION_TERMS:
            indicator = term.split(":", 1)[1]
            tau += float(fit.params[term]) * heldout[indicator].to_numpy(dtype=float)
        prediction_rows.append(
            pd.DataFrame(
                {
                    "ID": heldout["ID"].to_numpy(),
                    "village_id": heldout["village_id"].to_numpy(),
                    "fold": fold,
                    "model_fold": fold,
                    "outcome_observed": heldout["primary_outcome_observed"].to_numpy(),
                    "tau_hat_simple_oov": tau,
                    "benefit_hat_simple_oov": -tau,
                    "model_specification_id": SIMPLE_SPECIFICATION_ID,
                }
            )
        )
        audit_rows.append(
            {
                "fold": fold,
                "training_rows": len(train),
                "training_villages": len(training_villages),
                "heldout_villages": len(heldout_villages),
                "heldout_prediction_rows": len(heldout),
                "village_overlap": len(overlap),
                "converged": bool(fit.converged),
            }
        )
    predictions = pd.concat(prediction_rows, ignore_index=True).sort_values("ID").reset_index(drop=True)
    if len(predictions) != 4_533 or not predictions["ID"].is_unique:
        raise ValueError("simple benchmark OOV coverage is incomplete")
    return predictions, pd.DataFrame(audit_rows)


def validate_grf_predictions(matrix: pd.DataFrame, predictions: pd.DataFrame) -> pd.DataFrame:
    """Validate and key-align R-produced external OOV predictions."""
    required = {
        "ID",
        "village_id",
        "fold",
        "model_fold",
        "tau_hat_grf",
        "benefit_hat_grf",
        "training_village_count",
    }
    missing = sorted(required - set(predictions.columns))
    if missing:
        raise ValueError(f"GRF predictions missing columns: {missing}")
    keys = ["ID", "village_id", "fold"]
    if predictions.duplicated(keys).any() or predictions["ID"].duplicated().any():
        raise ValueError("duplicate GRF prediction key")
    if len(predictions) != len(matrix):
        raise ValueError("GRF prediction coverage differs from model matrix")
    expected = matrix[keys].copy()
    expected["_row_order"] = np.arange(len(expected))
    aligned = expected.merge(predictions, on=keys, how="left", validate="one_to_one")
    if aligned["tau_hat_grf"].isna().any():
        raise ValueError("GRF predictions do not align to every participant key")
    numeric = aligned[["tau_hat_grf", "benefit_hat_grf"]].to_numpy(dtype=float)
    if not np.isfinite(numeric).all():
        raise ValueError("GRF predictions must be finite")
    if not np.allclose(aligned["benefit_hat_grf"], -aligned["tau_hat_grf"], rtol=0, atol=1e-12):
        raise ValueError("GRF benefit sign does not equal negative tau")
    if not aligned["model_fold"].eq(aligned["fold"]).all():
        raise ValueError("GRF prediction model fold differs from held-out fold")
    heldout_counts = matrix.groupby("fold")["village_id"].nunique()
    expected_training = aligned["fold"].map(127 - heldout_counts)
    if not aligned["training_village_count"].eq(expected_training).all():
        raise ValueError("GRF training-village provenance is invalid")
    return aligned.sort_values("_row_order").drop(columns="_row_order").reset_index(drop=True)


def merge_oov_predictions(
    matrix: pd.DataFrame, simple: pd.DataFrame, grf: pd.DataFrame
) -> pd.DataFrame:
    """Merge same-fold simple and GRF predictions by stable identifiers."""
    validated_grf = validate_grf_predictions(matrix, grf)
    keys = ["ID", "village_id", "fold"]
    simple_columns = keys + [
        "tau_hat_simple_oov",
        "benefit_hat_simple_oov",
        "model_specification_id",
    ]
    if simple.duplicated(keys).any() or len(simple) != len(matrix):
        raise ValueError("simple prediction coverage or keys are invalid")
    base = matrix[[*keys, "W", "outcome_observed", "risk0"]].rename(
        columns={"outcome_observed": "evaluation_eligible"}
    )
    base["prediction_eligible"] = 1
    merged = base.merge(simple[simple_columns], on=keys, validate="one_to_one").merge(
        validated_grf[
            keys
            + [
                "tau_hat_grf",
                "benefit_hat_grf",
                "model_fold",
                "training_village_count",
            ]
        ],
        on=keys,
        validate="one_to_one",
    )
    if len(merged) != 4_533 or not merged["ID"].is_unique:
        raise ValueError("merged OOV prediction coverage is incomplete")
    if not np.allclose(
        merged["benefit_hat_simple_oov"],
        -merged["tau_hat_simple_oov"],
        rtol=0,
        atol=1e-12,
    ):
        raise ValueError("simple benefit sign does not equal negative tau")
    return merged.sort_values("ID").reset_index(drop=True)


def stable_frame_hash(frame: pd.DataFrame, sort_by: list[str]) -> str:
    """Hash canonical CSV serialization for provenance."""
    canonical = frame.sort_values(sort_by).to_csv(index=False, lineterminator="\n")
    return sha256(canonical.encode("utf-8")).hexdigest()


def fold_balance_summary(folds: pd.DataFrame) -> pd.DataFrame:
    """Return aggregate fold support without village identifiers."""
    rows = []
    for fold, group in folds.groupby("fold", sort=True):
        row = {
            "fold": int(fold),
            "villages": len(group),
            "control_villages": int(group["W"].eq(0).sum()),
            "intervention_villages": int(group["W"].eq(1).sum()),
            "participants": int(group["participant_count"].sum()),
            "outcome_observed": int(group["outcome_observed_count"].sum()),
        }
        row.update(
            {
                f"{field}_level1_villages": int(group[field].eq(1).sum())
                for field in DESIGN_COLUMNS
            }
        )
        rows.append(row)
    return pd.DataFrame(rows)


def run_phase7_pipeline(root: str | Path, rscript: str | None = None) -> dict[str, str]:
    """Generate frozen inputs and aligned external OOV predictions."""
    root = Path(root).resolve()
    derived = root / "data" / "derived"
    derived.mkdir(parents=True, exist_ok=True)
    cohort = build_causal_cohort(root / "data" / "raw" / "smarter_anonymised_data.csv")
    manifest = build_feature_manifest()
    folds = build_village_folds(cohort)
    matrix = build_model_matrix(cohort, folds)
    simple, simple_audit = crossfit_simple_benchmark(cohort, folds)

    paths = {
        "manifest": derived / "hte_feature_manifest.csv",
        "folds": derived / "village_folds.csv",
        "matrix": derived / "hte_model_matrix.csv",
        "fold_balance": derived / "fold_balance.csv",
        "simple": derived / "simple_hte_oov_predictions.csv",
        "simple_audit": derived / "simple_hte_crossfit_audit.csv",
        "grf": derived / "grf_oov_predictions.csv",
        "merged": derived / "hte_oov_predictions.csv",
        "metadata": derived / "grf_model_metadata.csv",
    }
    manifest.to_csv(paths["manifest"], index=False)
    folds.to_csv(paths["folds"], index=False)
    matrix.to_csv(paths["matrix"], index=False)
    fold_balance_summary(folds).to_csv(paths["fold_balance"], index=False)
    simple.to_csv(paths["simple"], index=False)
    simple_audit.to_csv(paths["simple_audit"], index=False)

    executable = rscript or shutil.which("Rscript")
    if not executable:
        raise RuntimeError("Rscript is required for Phase 7")
    subprocess.run(
        [
            executable,
            str(root / "r" / "grf_crossfit.R"),
            str(paths["matrix"]),
            str(paths["manifest"]),
            str(paths["grf"]),
            str(paths["metadata"]),
        ],
        cwd=root,
        check=True,
    )
    grf = pd.read_csv(paths["grf"])
    merged = merge_oov_predictions(matrix, simple, grf)
    merged.to_csv(paths["merged"], index=False)

    metadata = pd.read_csv(paths["metadata"])
    if len(metadata) != 1:
        raise ValueError("GRF metadata must contain exactly one row")
    metadata["feature_manifest_hash"] = stable_frame_hash(manifest, ["feature"])
    metadata["fold_map_hash"] = stable_frame_hash(folds[["village_id", "fold"]], ["village_id"])
    metadata["model_matrix_hash"] = stable_frame_hash(matrix, ["ID"])
    metadata["simple_formula_hash"] = sha256(SIMPLE_HTE_FORMULA.encode("utf-8")).hexdigest()
    metadata["grf_specification_id"] = MODEL_SPECIFICATION_ID
    metadata["simple_specification_id"] = SIMPLE_SPECIFICATION_ID
    metadata.to_csv(paths["metadata"], index=False)
    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = run_phase7_pipeline(root)
    merged = pd.read_csv(paths["merged"])
    print(
        "Phase-7 OOV artifacts written: "
        f"predictions={len(merged)}, evaluation_eligible={int(merged['evaluation_eligible'].sum())}, "
        f"villages={merged['village_id'].nunique()}, features={len(HTE_FEATURE_COLUMNS)}"
    )


if __name__ == "__main__":
    main()
