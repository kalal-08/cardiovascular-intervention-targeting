# HTE validation

## Evaluation design

Five whole-village folds separate model training from held-out predictions. Arm-specific nuisance models are cross-fitted on training villages. With outcome change `Y`, assignment `W`, nuisance predictions `m1`, `m0` and propensity 0.5, the evaluation score is:

```text
gamma_tau = (m1 − m0) + W/0.5 × (Y − m1) − (1 − W)/0.5 × (Y − m0)
gamma_benefit = −gamma_tau
```

These noisy causal evaluation scores are not observed individual treatment effects and never become deployment priority scores. Evaluation uses 4,508 observed-outcome participants. Its overall benefit estimate, 1.8641 pp, is a distinct cross-fitted estimator from the adjusted mixed-model estimate.

## Prioritization and calibration

Primary rankings use deterministic within-fold percentiles of GRF benefit, Simple HTE benefit or baseline risk. A deterministic random rule supplies a sanity comparison. AUTOC evaluates prioritization relative to the overall participant population, using village-cluster bootstrap uncertainty with 1,000 replicates.

| Rule | AUTOC | 95% CI |
| --- | ---: | --- |
| GRF | 0.6382 | 0.1131 to 1.1634 |
| Simple HTE | 0.7310 | 0.3434 to 1.1186 |
| Baseline Risk | 0.8818 | 0.3345 to 1.4291 |
| Random | 0.0213 | −0.2512 to 0.2938 |

Fold-adjusted calibration slopes are 0.916 for GRF and 0.882 for Simple HTE. Both intervals include the ideal slope of one; this is not proof of equivalence or superiority.

GRF-minus-Simple HTE AUTOC is −0.0928 (95% CI −0.5836 to 0.3980); GRF-minus-Baseline Risk is −0.2436 (−0.5369 to 0.0498). Neither comparison demonstrates superiority. Positive GRF prioritization evidence within this trial is supported, but incremental advantage is not demonstrated.

## Limits

Raw global ordering is a sensitivity analysis, not a replacement selected after viewing results. Participant-score Spearman agreement describes ranking similarity; it does not establish causal superiority. Baseline Risk measures burden, not treatment benefit. Descriptive subgroup estimates are not out-of-village prioritization validation.

Only 127 clusters support inference. No individual clinical recommendation, geographic transportability or operational targeting advantage follows from these validation results. Decision-level uncertainty is assessed separately in [rollout and uncertainty](ROLLOUT_AND_UNCERTAINTY.md).
