# Architecture

## Independent reporting implementations

The scientific workflow independently implements estimation in Python and R. Frozen, validated aggregate outputs supply two reporting implementations: a five-page Power BI dashboard and a native React/TypeScript application. The web application is not exported from, embedded in, or connected to Power BI.

```text
Locally retained trial data → Python/R estimation and cluster-aware validation
                           → frozen aggregate contracts
                              ├─ private Power BI implementation → public PDF/images
                              └─ deterministic whitelist export → public JSON → React/ECharts
```

Scientific estimates are not recomputed in the browser. Reviewed Python/R source, scientific tests and eight aggregate CSVs are public; participant-level working records and editable Power BI source are excluded. The original anonymized dataset is externally available through the source linked in the [methods](ANALYSIS_METHODS.md); local retention does not mean all inputs are inherently confidential.

## Public artifact responsibilities

| Public artifact | Purpose | Reproducibility boundary |
| --- | --- | --- |
| React/TypeScript source and web checks | Inspectable interactive implementation | Builds independently from shipped aggregate assets |
| Aggregate JSON, schemas and manifest | Typed, integrity-checked browser data | Frozen analytical outputs, not participant-level inputs |
| Power BI PDF, images and specification | Evidence of the implemented five-page report | Static outputs, not editable report/model source |
| Python/R source, scientific tests and dependency configuration | Cohort construction, estimation and policy evaluation | Requires separately acquired source data and regeneration before data-dependent tests |
| Eight aggregate CSVs | Reviewed scientific results | Not participant-level inputs or the complete intermediate output inventory |
| Curated methods and technical docs | Estimands, reasoning, design and validation | Document acquisition, execution order and remaining limitations |

## Data boundary

The public application ships eleven aggregate datasets plus schemas and a versioned manifest: thirteen JSON assets. The deterministic exporter uses an explicit field/row whitelist; generated TypeScript types express the exported contracts. Participant-level working records, treatment joins and restricted reference material are not browser assets.

The same-origin loader fetches `/data/` assets, checks contract integrity and validates required fields, types and keys before use. Shared pending requests prevent redundant loading. Failures produce a safe error state rather than silently displaying partial scientific results. Hashes detect byte changes against the supplied manifest; they are not an independent authenticity signature.

## Application ownership

React owns navigation, controls, native tables and disclosure state. ECharts owns quantitative plots. Shared policy metadata, formatting, layout and chart wrappers keep page implementations consistent without duplicating navigation. TypeScript provides explicit route, selector and dataset contracts.

The routes are `/overview`, `/risk-vs-benefit`, `/hte-validation`, `/rollout` and `/robustness`. Page-scoped query parameters encode supported selectors and sorting. Invalid or duplicate parameter values fall back to defined defaults; canonical URLs omit default values. Same-session navigation remembers page state. Refresh restores URL-encoded state; browser Back/Forward restores history entries. Transient row selection, scroll position and inspection state are not promises of persistence across remounts.

## Build and hosting

Vite compiles the application. Cloudflare Workers Static Assets is the configured hosting target, with SPA fallback for direct route requests. No runtime database, analytical API, authentication or secrets are required. Deployment and hosted validation have not been performed.

Use the [root quick start](../../README.md#run-locally) for installation and preview. Public builds validate shipped JSON without private inputs. Local scientific regeneration and reconciliation remain separate from the public build. See [validation](VALIDATION.md) and [analysis methods](ANALYSIS_METHODS.md).
