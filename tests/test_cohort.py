from hashlib import sha256
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from intervention_targeting import cohort


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"
EXPECTED_HASH = "2a42364e388ed21ae9b4dc0038424c3e4e4ffb60e9aebd8edef7db8d356b7741"

EXPECTED_BASELINE_FEATURES = {
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
}

EXPECTED_FOLLOWUP_FIELDS = {
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
}


def build():
    return cohort.build_causal_cohort(RAW)


def test_raw_identity_and_randomized_source_cohort_are_preserved():
    assert sha256(RAW.read_bytes()).hexdigest() == EXPECTED_HASH

    frame = build()

    assert len(frame) == 4_533
    assert frame["ID"].notna().all()
    assert frame["ID"].is_unique
    assert frame["village_id"].nunique() == 127
    assert frame["W"].notna().all()
    assert set(frame["W"].unique()) == {0, 1}
    assert frame["W"].value_counts().to_dict() == {1: 2_297, 0: 2_236}
    assert (frame["W"] == frame["group"].map({1: 1, 2: 0})).all()
    assert frame.groupby("village_id")["W"].nunique().eq(1).all()
    assert frame.groupby("W")["village_id"].nunique().to_dict() == {0: 63, 1: 64}


def test_available_primary_outcome_cohort_and_delta_are_explicit():
    frame = build()
    observed = frame["primary_outcome_observed"]

    assert observed.dtype == bool
    assert observed.sum() == 4_508
    assert frame["risk4"].notna().sum() == 4_508
    assert (~observed).sum() == 25
    assert frame.loc[~observed, "W"].value_counts().to_dict() == {1: 13, 0: 12}
    assert len(frame) == 4_533
    assert frame.loc[~observed, "risk4"].isna().all()
    assert frame.loc[~observed, "delta_risk"].isna().all()
    assert frame.loc[observed, "delta_risk"].notna().all()
    np.testing.assert_allclose(
        frame.loc[observed, "delta_risk"],
        frame.loc[observed, "risk4"] - frame.loc[observed, "risk0"],
    )


def test_feature_contract_is_explicit_and_leakage_safe():
    allow = set(cohort.HTE_FEATURE_ALLOWLIST)
    deny = set(cohort.HTE_FEATURE_DENYLIST)

    assert allow == EXPECTED_BASELINE_FEATURES
    assert allow.isdisjoint(deny)
    assert EXPECTED_FOLLOWUP_FIELDS <= deny
    assert {"ID", "village_id", "group", "W", "delta_risk", "primary_outcome_observed"} <= deny
    assert not any(name.endswith("4") or name.endswith("_4") for name in allow)
    assert set(cohort.STRUCTURAL_COLUMNS) == {"ID", "village_id", "group", "W"}
    assert set(cohort.OUTCOME_COLUMNS) == {
        "risk0",
        "risk4",
        "delta_risk",
        "primary_outcome_observed",
    }


def test_design_fields_are_complete_and_constant_within_village():
    frame = build()
    design = list(cohort.DESIGN_COLUMNS)

    assert set(design) == {
        "vc_age_grp",
        "vc_sbp_grp",
        "vc_risk_grp",
        "doctor_college_above",
    }
    assert frame[design].notna().all().all()
    assert frame.groupby("village_id")[design].nunique().le(1).all().all()


def test_build_is_deterministic_and_preserves_raw_fields():
    raw = pd.read_csv(RAW)
    first = build()
    second = build()

    pd.testing.assert_frame_equal(first, second)
    assert list(first.columns[: len(raw.columns)]) == list(raw.columns)
    assert list(first.columns[-3:]) == ["W", "primary_outcome_observed", "delta_risk"]


def test_wrong_raw_file_is_rejected_before_use(tmp_path):
    changed = tmp_path / "changed.csv"
    changed.write_bytes(RAW.read_bytes() + b"\n")

    with pytest.raises(ValueError, match="checksum"):
        cohort.build_causal_cohort(changed)


def test_writer_never_overwrites_raw_and_writes_rebuildable_output(tmp_path):
    with pytest.raises(ValueError, match="overwrite"):
        cohort.write_causal_cohort(RAW, RAW)

    output = tmp_path / "causal_cohort.csv"
    expected = cohort.write_causal_cohort(RAW, output)
    actual = pd.read_csv(output)

    assert output.is_file()
    pd.testing.assert_frame_equal(actual, expected, check_dtype=False)
