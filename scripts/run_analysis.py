"""Regenerate scientific outputs from the externally acquired trial CSV."""

from pathlib import Path

from intervention_targeting import (
    cohort, heterogeneity, hte_crossfit, hte_validation, intervention_effects,
    policy_robustness, policy_uncertainty, trial_effects, village_aggregation,
    rollout_policy,
)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    derived = root / "data" / "derived"
    figures = root / "reports" / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    population = cohort.write_causal_cohort(
        root / "data" / "raw" / "smarter_anonymised_data.csv",
        derived / "causal_cohort.csv",
    )
    frame = trial_effects.build_primary_model_frame(population)
    primary = trial_effects.summarize_primary_result(
        trial_effects.fit_primary_model(frame), frame,
    )
    primary.update(trial_effects.compare_with_publication(
        primary["estimate"], primary["ci_lower"], primary["ci_upper"],
    ))
    if primary["reproduction_status"] != "REPRODUCED":
        raise RuntimeError("Average-effect reproduction failed; downstream analysis stopped")
    trial_effects.write_aggregate_result(primary, derived / "trial_reproduction.csv")

    secondary = intervention_effects.estimate_secondary_effects(population)
    intervention_effects.write_aggregate_tables({
        "baseline_balance": intervention_effects.baseline_balance(population),
        "cluster_balance_context": intervention_effects.cluster_balance_context(population),
        "primary_risk_summary": intervention_effects.primary_risk_summary(population),
        "intervention_effect_summary": intervention_effects.intervention_effect_summary(primary, secondary),
        "outcome_change_summary": intervention_effects.outcome_change_summary(population),
        "outcome_missingness": intervention_effects.missingness_summary(population),
    }, derived)
    analysis_frame = heterogeneity.prepare_analysis_frame(population)
    effects, interactions = heterogeneity.estimate_all_moderators(analysis_frame, primary)
    heterogeneity.write_aggregate_outputs({
        "classical_subgroup_effects": effects,
        "classical_interactions": interactions,
        "classical_hte_model_summary": heterogeneity.summarize_simple_hte_benchmark(
            heterogeneity.fit_simple_hte_benchmark(analysis_frame), analysis_frame,
        ),
    }, derived)

    for label, run in (
        ("Out-of-village models", hte_crossfit.run_phase7_pipeline),
        ("HTE validation", hte_validation.run_phase8_pipeline),
        ("Village aggregation", village_aggregation.run_phase9_pipeline),
        ("Rollout", rollout_policy.run_phase10_pipeline),
        ("Bootstrap uncertainty", policy_uncertainty.run_phase11a_pipeline),
        ("Robustness", policy_robustness.run_phase11b_pipeline),
    ):
        print(label, flush=True)
        run(root)
    print("Scientific pipeline complete; participant-level outputs remain ignored.")


if __name__ == "__main__":
    main()
