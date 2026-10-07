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

The requested route starts code and required data loading together before mount. Known same-origin `/data/` downloads overlap, but contract versions, hashes, required fields, types and keys are verified before consumption. Shared requests prevent redundant downloads; rejected cache entries permit a later fresh-request retry. Data failures retain explicit error presentation rather than partial scientific results. Failed lazy-module imports remain a separate reload-recovery limitation. No background or hover/focus warming is implemented. Hashes detect byte changes against the supplied manifest, not independent authenticity.

## Application ownership

React owns navigation, controls, native tables and disclosure state. ECharts owns quantitative plots. Shared policy metadata, formatting, layout and chart wrappers keep page implementations consistent without duplicating navigation. TypeScript provides explicit route, selector and dataset contracts.

The routes are `/overview`, `/risk-vs-benefit`, `/hte-validation`, `/rollout` and `/robustness`. Page-scoped query parameters encode supported selectors and sorting. Invalid or duplicate parameter values fall back to defined defaults; canonical URLs omit default values. Same-session navigation remembers page state. Refresh restores URL-encoded state; browser Back/Forward restores history entries. Transient row selection, scroll position and inspection state are not promises of persistence across remounts.

## Build and hosting

Vite compiles the application; Cloudflare Workers Static Assets serves the [live dashboard](https://cit-dashboard.urvilkalal07.workers.dev/overview) and same-origin aggregate JSON. SPA fallback supports direct requests to all five routes. No runtime database, analytical API, authentication or secrets are required.

The web build depends only on shipped public assets. Scientific regeneration and editable Power BI authoring are separate workflows, not deployment prerequisites. The existing Git integration builds a preview version; production promotion is a separate release action. Even documentation-only pushes may trigger that build.

Viewport-aware CSS controls spacing and reflow; chart containers drive ECharts resizing without recreating the scientific data. Dense tables and evidence keep intentional scrolling rather than hiding content. See [dashboard decisions](DASHBOARD_DECISIONS.md#viewport-adaptation) for layout and interaction boundaries.

Use the [root quick start](../../README.md#run-the-web-application-locally) for installation and preview. Public builds validate shipped JSON without private inputs. Local scientific regeneration and reconciliation remain separate from the public build. See [validation](VALIDATION.md) and [analysis methods](ANALYSIS_METHODS.md).
