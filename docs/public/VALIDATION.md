# Validation and limitations

## Publicly runnable checks

From `web/`, after installing the pinned dependencies:

```powershell
npm.cmd run data:public:check
npm.cmd run build
npm.cmd run preview
# In another terminal while preview runs:
node scripts/check-data-http.mjs http://127.0.0.1:4173
```

Use `npm` instead of `npm.cmd` in other shells. The public-data regression rejects changed bytes and invalid fields/types/keys. Build validates the public contract, checks TypeScript and compiles the app. HTTP checks cover thirteen JSON assets, five routes and approved served build files. These checks require no private Power BI model or analytical inputs.

## Retained local scientific and interaction evidence

The local scientific workflow reconciles 141/141 frozen targets and passes six data regression tests. Deterministic exports preserve source precision; UI rounding is presentation-only. These checks require retained local scientific inputs and do not imply that the public repository can reproduce the underlying trial analysis.

Recorded rebuilt-browser checks cover selectors, URL/default/history behavior, keyboard navigation, tooltip/focus/touch access, loading/error states and responsive/enlarged-text layouts. Rollout checks include fifteen policy/anchor states and all 128 inspection capacities. Robustness checks include 75 selector states, eighteen sort combinations, all 127 village rows and selection integrity. The local public-only rehearsal builds independently of private files and serves thirteen JSON assets, five routes and 29 approved build files.

These are local validation results, not hosted certification. Documentation-only changes do not constitute a new full product-browser test run. Some deeper QA scripts require separately available browser tooling, retained scientific contracts or historical comparison evidence; they are not public-build prerequisites.

## Open limitations

Exact Baseline Risk orange `#F28C00` is retained, with approximately 2.463:1 text contrast on white. Accessibility acceptance remains open; visual approval is not WCAG conformance. Actual screen-reader and physical-device execution, Firefox/Safari coverage and hosted validation are not claimed. The static Power BI PDF is untagged.

ECharts produces a known bundle-size warning. Device-specific performance measurements are not universal guarantees. Hash validation checks integrity against supplied metadata, not independent scientific authenticity. Analytical limitations are documented in [methods](ANALYSIS_METHODS.md), [HTE validation](HTE_VALIDATION.md) and [rollout/uncertainty](ROLLOUT_AND_UNCERTAINTY.md).
