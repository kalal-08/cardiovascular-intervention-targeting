"""Build the locked Phase 3 causal cohort from the immutable SMARTER CSV."""

from hashlib import sha256
from pathlib import Path

import pandas as pd


RAW_SHA256 = "2a42364e388ed21ae9b4dc0038424c3e4e4ffb60e9aebd8edef7db8d356b7741"

STRUCTURAL_COLUMNS = ("ID", "village_id", "group", "W")
DESIGN_COLUMNS = (
    "vc_age_grp",
    "vc_sbp_grp",
    "vc_risk_grp",
    "doctor_college_above",
)
OUTCOME_COLUMNS = ("risk0", "risk4", "delta_risk", "primary_outcome_observed")
FOLLOWUP_COLUMNS = (
    "risk4",
    "risk_lifetime_4",
    "SBP4",
    "DBP4",
    "GLU4",
    "NHDL4",
    "obesity_4",
    "smk_daily_4",
    "PA_lt3000_4",
    "LTPA4",
)
HTE_FEATURE_ALLOWLIST = (
    "age",
    "male",
    "education_high_above",
    "occupation_farmer",
    "Last_year_income_lt_10k",
    "marriage_yes",
    "insure_yes",
    "BMI0_grp",
    "waist0_normal",
    "risk0",
    "risk_lifetime_0",
    "SBP0",
    "DBP0",
    "GLU0",
    "NHDL0",
    "obesity_0",
    "smk_daily_0",
    "PA_lt3000_0",
    "LTPA0",
)
HTE_FEATURE_DENYLIST = (
    "ID",
    "village_id",
    "group",
    "W",
    "delta_risk",
    "primary_outcome_observed",
    *FOLLOWUP_COLUMNS,
)

REQUIRED_RAW_COLUMNS = (
    "ID",
    "village_id",
    "group",
    *DESIGN_COLUMNS,
    *HTE_FEATURE_ALLOWLIST,
    *FOLLOWUP_COLUMNS,
)


def _validate_raw(frame: pd.DataFrame) -> None:
    missing = sorted(set(REQUIRED_RAW_COLUMNS) - set(frame.columns))
    if missing:
        raise ValueError(f"raw data missing required columns: {missing}")
    if len(frame) != 4_533:
        raise ValueError(f"expected 4533 randomized participants, found {len(frame)}")
    if frame["ID"].isna().any() or not frame["ID"].is_unique:
        raise ValueError("ID must be complete and unique")
    if frame["village_id"].isna().any() or frame["village_id"].nunique() != 127:
        raise ValueError("village_id must identify exactly 127 villages")
    if set(frame["group"].dropna().unique()) != {1, 2}:
        raise ValueError("group must contain only randomized codes 1 and 2")
    cluster_fields = ["group", *DESIGN_COLUMNS]
    if frame[cluster_fields].isna().any().any():
        raise ValueError("treatment and design fields must be complete")
    if not frame.groupby("village_id")[cluster_fields].nunique().le(1).all().all():
        raise ValueError("treatment and design fields must be constant within village")


def build_causal_cohort(raw_path: str | Path) -> pd.DataFrame:
    """Return all randomized participants with locked treatment/outcome fields."""
    raw_path = Path(raw_path)
    actual_hash = sha256(raw_path.read_bytes()).hexdigest()
    if actual_hash != RAW_SHA256:
        raise ValueError(f"raw checksum mismatch: {actual_hash}")

    frame = pd.read_csv(raw_path)
    _validate_raw(frame)

    cohort = frame.copy()
    cohort["W"] = cohort["group"].map({1: 1, 2: 0}).astype("int8")
    cohort["primary_outcome_observed"] = cohort["risk0"].notna() & cohort["risk4"].notna()
    cohort["delta_risk"] = cohort["risk4"] - cohort["risk0"]

    if cohort["W"].value_counts().to_dict() != {1: 2_297, 0: 2_236}:
        raise ValueError("randomized treatment counts differ from the locked contract")
    if int(cohort["primary_outcome_observed"].sum()) != 4_508:
        raise ValueError("primary outcome availability differs from the locked contract")
    missing_by_arm = cohort.loc[~cohort["primary_outcome_observed"], "W"].value_counts().to_dict()
    if missing_by_arm != {1: 13, 0: 12}:
        raise ValueError("missing primary outcomes by arm differ from the locked contract")

    return cohort


def write_causal_cohort(raw_path: str | Path, output_path: str | Path) -> pd.DataFrame:
    """Build and write the derived cohort without permitting raw-data overwrite."""
    raw_path, output_path = Path(raw_path), Path(output_path)
    if raw_path.resolve() == output_path.resolve():
        raise ValueError("refusing to overwrite raw data")

    cohort = build_causal_cohort(raw_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cohort.to_csv(output_path, index=False)
    return cohort


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    raw = root / "data" / "raw" / "smarter_anonymised_data.csv"
    output = root / "data" / "derived" / "causal_cohort.csv"
    cohort = write_causal_cohort(raw, output)
    print(
        f"wrote {output}: rows={len(cohort)}, villages={cohort['village_id'].nunique()}, "
        f"primary_outcome_observed={int(cohort['primary_outcome_observed'].sum())}"
    )


if __name__ == "__main__":
    main()
