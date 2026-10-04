# Village rollout and uncertainty

## Retrospective policy construction

Capacity `K` counts whole villages, not participants or expenditure. GRF and Simple HTE village signals aggregate out-of-village predicted benefit; Baseline Risk aggregates baseline predicted risk. These signals remain distinct from the outcome-based evaluation score.

Frozen within-fold-normalized priority rules create nested selections over all 127 trial villages. The evaluation uses observed-outcome participants; coverage counts retain the randomized population. Prespecified capacity anchors are 13, 32, 64, 95 and 127 villages. They are hypothetical retrospective scenarios, not historical quotas or recommended operating cutoffs.

```text
Population rollout value = selected participants' gamma_benefit sum / 4,508
Random expected value = (K / 127) × overall gamma_benefit
Gain versus random = population rollout value − random expected value
```

At `K=0`, value and gain are zero. At `K=127`, all policies select every village, population value reconciles to 1.8641 pp and gain is zero. Full rollout is a reconciliation endpoint, not an identified optimum.

## Uncertainty and result

Two thousand village bootstrap replicates resample the observed 64 intervention and 63 control villages separately. Shared replicate multiplicities support paired comparisons. Policy membership and fitted scores remain frozen; the bootstrap does not refit the forest or fully propagate model-training uncertainty.

Intervals are pointwise 95% percentile intervals, not simultaneous bands. Formal interpretation uses prespecified non-full anchors, rather than searching the full curves for favorable points.

At `K=64`, gain versus random is:

| Policy | Gain, pp | 95% CI, pp |
| --- | ---: | --- |
| GRF | −0.0240 | −0.4048 to 0.3445 |
| Simple HTE | 0.1390 | −0.2353 to 0.5103 |
| Baseline Risk | 0.0848 | −0.2785 to 0.4690 |

All twelve policy-versus-random intervals at non-full anchors include zero. No single robust policy winner is established. Positive point estimates alone do not establish targeting advantage.

## Sensitivities and boundaries

Raw/global ranking, equal-village weighting and leave-one-village-out diagnostics probe dependence on ranking construction, estimand and influential clusters. They do not replace the participant-weighted primary analysis or establish superiority. Policy overlap is set agreement, not causal performance. Age, sex, education, occupation and income coverage summaries are descriptive, not fairness targets.

The endpoint is modeled cardiovascular risk, not observed events. Costs, stakeholder utilities and geographic validation are unavailable; no cost-effectiveness, optimal-capacity or transportability claim is supported. The public application explores these frozen analytical contracts rather than prescribing operational deployment.
