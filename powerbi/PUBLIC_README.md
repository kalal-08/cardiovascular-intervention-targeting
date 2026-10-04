# Power BI implementation and public specification

The analysis was first implemented and validated as a five-page Power BI dashboard. The React/TypeScript application was subsequently implemented independently from the same validated analytical contracts and approved dashboard design; it was not exported or generated from Power BI.

Editable PBIX/PBIP/PBIR projects, semantic/model source, embedded model binaries, private analytical inputs and historical backups remain private. The public web implementation is fully inspectable. Public report outputs document the Power BI result without exposing editable internals or claiming complete public analytical reproducibility.

## Final approved report outputs

The [five-page PDF](../reports/Cardiovascular_Intervention_Targeting_final.pdf) is a static report export. These five clean final images demonstrate one approved state per page:

| Page | Final image | Contract |
| --- | --- | --- |
| Overview | [Overview](../reports/figures/powerbi/phase12b_final_20261001/page_01_overview.png) | Fixed randomized population, allocation, available-primary-outcome effect and 95% CI; no analytical selector. |
| Risk vs Benefit | [Risk vs Benefit](../reports/figures/powerbi/phase12b_final_20261001/page_02_risk_vs_benefit.png) | 127 anonymized villages; GRF/Simple HTE switches the frozen benefit signal on common axes, not the fixed correlations. Default GRF. |
| HTE Validation | [HTE Validation](../reports/figures/powerbi/phase12b_final_20261001/page_03_hte_validation.png) | AUTOC, calibration, participant-score agreement and 13 descriptive subgroup rows. Prioritization support does not demonstrate superiority. |
| Rollout | [Rollout](../reports/figures/powerbi/phase12b_final_20261001/page_04_rollout.png) | Full K=0-127 curves, frozen pointwise intervals, selected anchor values and coverage. Default Simple HTE/K=64; no optimal-capacity recommendation. |
| Robustness | [Robustness](../reports/figures/powerbi/phase12b_final_20261001/page_05_robustness.png) | Separate policy ranks/signals for all 127 villages, overlap, sensitivity and descriptive coverage. Default Simple HTE/K=64/Age/Focus rank ascending. |

The PDF/images show only visible rows and recorded states. They do not replace the interactive dashboard or prove every interaction. The native report retains all 127 village records. The PDF is untagged; accessible-PDF certification is not claimed.

## Analytical and implementation boundaries

The SMARTER village-cluster trial includes 4,533 randomized participants in 127 villages and 4,508 observed primary outcomes. The endpoint is predicted 10-year ASCVD risk, not observed cardiovascular events. The adjusted effect is approximately -1.880 percentage points (95% CI -2.564 to -1.196); lower values favor intervention. Available-primary-outcome analysis is not an unqualified full-population ITT claim.

Python/R owns estimation, out-of-village validation and village-level resampling. Power BI imports frozen aggregate results; Power Query applies supplied fields/types and DAX handles presentation selection/formatting, not re-estimation. No participant-level dataset is included in the public report outputs. Public anonymized village identifiers and aggregate counts are intentional.

Policy colors are GRF `#0B2E83`, Simple HTE `#0798A5` and Baseline Risk `#F28C00`, with labels and distinct graphical encodings supplementing color. The web retains its documented small-teal text adjustment; exact orange text has an open contrast limitation and is not WCAG-certified.

At K=127, rollout population value reconciles to approximately 1.8641 pp and gain versus random is zero. Page-5 capacity-specific robustness is not applicable at full capacity, while overlap and coverage still reconcile. Ranking agreement is not causal superiority; subgroup intervals are not interaction tests; descriptive coverage is not a fairness target. No single robust policy winner is established.

Local validation includes 141 reconciliation targets and six data regressions. The public web build validates its shipped JSON without accessing private Power BI or analytical inputs. Hosted, physical-device and assistive-technology certification are separate gates. See the [project README](../README.md) for build instructions and current limitations.

No open-source LICENSE has been authorized. Public availability of these outputs or documentation does not grant reuse rights to the private Power BI implementation or other project materials.
