from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from intervention_targeting import heterogeneity
from intervention_targeting.cohort import FOLLOWUP_COLUMNS, HTE_FEATURE_DENYLIST, build_causal_cohort
from intervention_targeting.intervention_effects import read_canonical_primary_effect


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "smarter_anonymised_data.csv"
REPRODUCTION = ROOT / "data" / "derived" / "trial_reproduction.csv"


@pytest.fixture(scope="module")
def frame():
    return heterogeneity.prepare_analysis_frame(build_causal_cohort(RAW))


@pytest.fixture(scope="module")
def results(frame):
    primary = read_canonical_primary_effect(REPRODUCTION)
    return heterogeneity.estimate_all_moderators(frame, primary)


def test_frozen_source_moderators_are_reconstructable_baseline_fields():
    assert tuple(heterogeneity.MODERATOR_SPECS) == (
        "age",
        "sex",
        "education",
        "occupation",
        "income",
        "baseline_risk",
    )
    assert heterogeneity.MODERATOR_SPECS["age"]["source_definition"] == "<60 vs >=60 years"
    assert heterogeneity.MODERATOR_SPECS["baseline_risk"]["source_definition"] == "<16 vs >=16%"
    assert heterogeneity.MODERATOR_SPECS["baseline_risk"]["reconstruction_status"] == (
        "PARTIALLY RECONSTRUCTABLE"
    )
    raw_fields = {spec["raw_field"] for spec in heterogeneity.MODERATOR_SPECS.values()}
    assert raw_fields == {
        "age",
        "male",
        "education_high_above",
        "occupation_farmer",
        "Last_year_income_lt_10k",
        "risk0",
    }
    assert not raw_fields & set(HTE_FEATURE_DENYLIST)
    assert not raw_fields & set(FOLLOWUP_COLUMNS)
    assert not any(name.endswith("4") or name.endswith("_4") for name in raw_fields)


def test_model_frame_preserves_outcome_treatment_ids_and_villages(frame):
    assert len(frame) == 4_508
    assert frame["ID"].is_unique
    assert frame["village_id"].nunique() == 127
    assert frame.groupby("village_id")["W"].nunique().eq(1).all()
    assert frame["W"].value_counts().to_dict() == {1: 2_284, 0: 2_224}
    np.testing.assert_allclose(frame["delta_risk"], frame["risk4"] - frame["risk0"])
    assert set(frame["age_ge_60"].unique()) == {0, 1}
    assert set(frame["risk_ge_16"].unique()) == {0, 1}


def test_subgroup_support_matches_source_counts_and_retains_both_arms(frame):
    support = heterogeneity.subgroup_support(frame)
    age = support.query("moderator == 'age'").set_index(["subgroup_value", "W"])
    sex = support.query("moderator == 'sex'").set_index(["subgroup_value", "W"])
    risk = support.query("moderator == 'baseline_risk'").set_index(["subgroup_value", "W"])

    assert age["analysis_n"].to_dict() == {(0, 0): 1_317, (0, 1): 1_371, (1, 0): 907, (1, 1): 913}
    assert sex["analysis_n"].to_dict() == {(0, 0): 1_142, (0, 1): 1_131, (1, 0): 1_082, (1, 1): 1_153}
    assert risk["analysis_n"].to_dict() == {(0, 0): 1_133, (0, 1): 1_132, (1, 0): 1_091, (1, 1): 1_152}
    assert support.groupby(["moderator", "subgroup_value"])["W"].nunique().eq(2).all()
    assert support["villages"].ge(55).all()
    assert support["missing_n"].eq(0).all()


def test_interaction_formulas_preserve_adjustment_and_avoid_duplicate_terms():
    for name, spec in heterogeneity.MODERATOR_SPECS.items():
        formula, term = heterogeneity.interaction_specification(name)
        assert formula.startswith("delta_risk ~ W + risk0 + age +")
        assert term in formula
        assert "village_id" not in formula
        assert "ID" not in formula
        assert not any(field in formula for field in FOLLOWUP_COLUMNS)
        assert formula.count("C(male)") == 1
        if spec["indicator"] in {"age_ge_60", "risk_ge_16"}:
            assert formula.count(f" + {spec['indicator']} + ") == 1


def test_interaction_results_are_complete_finite_and_mathematically_extracted(results):
    effects, interactions = results
    assert interactions["moderator"].tolist() == list(heterogeneity.MODERATOR_SPECS)
    assert interactions["analysis_n"].eq(4_508).all()
    assert interactions["villages"].eq(127).all()
    assert interactions["converged"].all()
    assert np.isfinite(
        interactions[["interaction_effect", "interaction_se", "interaction_ci_lower", "interaction_ci_upper", "interaction_p_value"]]
    ).all().all()
    assert (interactions["interaction_ci_lower"] < interactions["interaction_ci_upper"]).all()
    assert len(effects) == 13
    assert effects.iloc[0]["moderator"] == "Overall"
    assert effects.iloc[0]["treatment_effect"] == -1.8799816659919089
    for moderator in heterogeneity.MODERATOR_SPECS:
        rows = effects.query("moderator == @moderator").sort_values("subgroup_value")
        interaction = interactions.query("moderator == @moderator").iloc[0]
        assert len(rows) == 2
        assert np.isclose(
            rows.iloc[1]["treatment_effect"] - rows.iloc[0]["treatment_effect"],
            interaction["interaction_effect"],
        )
        assert rows["ci_lower"].lt(rows["treatment_effect"]).all()
        assert rows["treatment_effect"].lt(rows["ci_upper"]).all()
    assert np.allclose(
        heterogeneity.effect_to_benefit(effects["treatment_effect"]),
        -effects["treatment_effect"],
    )


def test_source_comparison_stays_separate_from_public_data_estimates(results):
    effects, interactions = results
    subgroup = effects.query("moderator != 'Overall'")
    assert subgroup["source_treatment_effect"].notna().all()
    assert interactions["source_interaction_p_value"].notna().all()
    assert not np.allclose(subgroup["treatment_effect"], subgroup["source_treatment_effect"])
    assert set(interactions["source_comparison_status"]) <= {
        "BROADLY CONSISTENT",
        "PUBLIC RISK-GROUP MEMBERSHIP DIFFERS",
    }


def test_supplementary_bh_values_are_complete_and_do_not_filter_results(results):
    _, interactions = results
    expected = np.array([0.03, 0.04, 0.04])
    np.testing.assert_allclose(
        heterogeneity.benjamini_hochberg(np.array([0.01, 0.04, 0.03])), expected
    )
    assert interactions["bh_q_value"].notna().all()
    assert interactions["bh_q_value"].between(0, 1).all()
    assert len(interactions) == len(heterogeneity.MODERATOR_SPECS)


def test_one_fixed_simple_benchmark_has_no_policy_or_prediction_output(frame):
    fit = heterogeneity.fit_simple_hte_benchmark(frame)
    summary = heterogeneity.summarize_simple_hte_benchmark(fit, frame)

    assert fit.converged
    assert fit.model.formula == heterogeneity.SIMPLE_HTE_FORMULA
    assert summary["term"].tolist() == ["W", *heterogeneity.SIMPLE_INTERACTION_TERMS]
    assert summary["analysis_n"].eq(4_508).all()
    assert summary["villages"].eq(127).all()
    assert np.isfinite(summary[["estimate", "std_error", "ci_lower", "ci_upper", "p_value"]]).all().all()
    forbidden = {"ID", "village_id", "cate", "rank", "priority", "policy_value"}
    assert not forbidden & set(summary.columns)


def test_aggregate_outputs_and_forest_plot_are_safe_and_deterministic(tmp_path, results, frame):
    effects, interactions = results
    benchmark = heterogeneity.summarize_simple_hte_benchmark(
        heterogeneity.fit_simple_hte_benchmark(frame), frame
    )
    tables = {
        "classical_subgroup_effects": effects,
        "classical_interactions": interactions,
        "classical_hte_model_summary": benchmark,
    }
    heterogeneity.write_aggregate_outputs(tables, tmp_path)
    first_csv = {path.name: path.read_bytes() for path in tmp_path.glob("*.csv")}
    heterogeneity.write_aggregate_outputs(tables, tmp_path)
    assert first_csv == {path.name: path.read_bytes() for path in tmp_path.glob("*.csv")}
    for path in tmp_path.glob("*.csv"):
        saved = pd.read_csv(path)
        assert "ID" not in saved.columns
        assert "village_id" not in saved.columns
        assert len(saved) < 4_508

    figure = tmp_path / "classical_subgroup_effects.png"
    heterogeneity.plot_subgroup_effects(effects, figure)
    first_png = figure.read_bytes()
    heterogeneity.plot_subgroup_effects(effects, figure)
    assert first_png == figure.read_bytes()
    assert first_png.startswith(b"\x89PNG")
