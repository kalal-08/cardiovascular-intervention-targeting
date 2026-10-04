# Analysis methods and provenance

## Study and estimand

The source is the SMARTER village-cluster randomized trial in rural China, reported in [BMJ](https://doi.org/10.1136/bmj-2024-082765), with public source data identified by [Dryad](https://doi.org/10.5061/dryad.tmpg4f58w). Source-data availability does not mean that participant-level working files are included here. Dataset and reference-code rights are distinct; the restricted statistical reference was not redistributed or reused as implementation source.

The trial randomized 4,533 participants in 127 villages. Primary outcomes are observed for 4,508 participants; 25 missing outcomes were not imputed. The analysis is an available-primary-outcome analysis according to randomized village assignment, not an unqualified full-population intention-to-treat claim.

The endpoint is change in predicted 10-year ASCVD risk: follow-up minus baseline. Treatment effect is intervention minus control; negative values favor intervention. Displayed predicted benefit reverses this sign, so positive benefit is favorable. Effects concern village assignment to the intervention package, not individual prescriptions or effects of isolated components.

## Average-effect reproduction and diagnostics

The independent primary model uses restricted maximum likelihood, a village random intercept, baseline risk, demographic adjustment and four minimisation factors. The adjusted estimate is −1.880 percentage points, with 95% CI −2.564 to −1.196, closely agreeing with the published −1.88 (−2.57 to −1.19).

The public age field is the best available counterpart to the reference analysis's internal age field; exact internal provenance is unavailable. Python inference uses large-sample Wald intervals rather than the reference's denominator degrees of freedom. These differences prevent a claim of exact software-level replication.

Baseline balance and observed within-arm changes are descriptive diagnostics, not causal treatment contrasts. Participant weighting defines the primary estimand; villages remain intact as randomization, validation and resampling units.

## Heterogeneity

Classical analysis examines six prespecified moderators: age, sex, education, occupation, household income and baseline risk. Interaction tests, not differences in subgroup significance or confidence-interval overlap, address effect modification. Multiplicity and limited cluster information constrain interpretation. Rounded public baseline-risk values only partially reconstruct the original 16% grouping.

A compact Simple HTE benchmark is compared with one advanced model, a cluster-aware R `grf` causal forest. Only pre-treatment predictors enter the feature matrix. Identifiers, assignment, follow-up measurements, outcome availability and derived evaluation scores are excluded as predictors. Whole villages are held out in five folds; predictions cover the randomized population, while outcome fitting/evaluation uses observed outcomes. Both models are trained without the held-out villages.

The forest uses honest estimation and the trial's target propensity of 0.5. This does not reconstruct the full county-stratified minimisation mechanism. Model complexity was not expanded merely to obtain a favorable winner. See [HTE validation](HTE_VALIDATION.md) for evidence and [rollout](ROLLOUT_AND_UNCERTAINTY.md) for decision-level interpretation.
