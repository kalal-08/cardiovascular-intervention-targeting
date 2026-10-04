# Cardiovascular Intervention Targeting

A cluster-aware decision-analytics project combining independent Python/R analysis, a five-page Power BI dashboard and a native React/TypeScript application.

The central question: does prioritizing villages by predicted intervention benefit improve retrospective rollout value compared with prioritizing baseline risk or selecting villages at random?

## Problem and approach

High baseline cardiovascular risk does not necessarily imply greater treatment benefit. This project compares GRF, Simple HTE and Baseline Risk prioritization using the SMARTER village-cluster randomized trial: **4,533 participants in 127 villages**, with **4,508 observed primary outcomes**.

The workflow independently reproduces the average effect, estimates heterogeneity, validates predictions out of village, and evaluates hypothetical capacity-constrained rollout with village-level uncertainty. Villages remain indivisible validation, resampling and capacity units.

The analysis was first implemented and validated as a five-page Power BI dashboard. A native React/TypeScript web application was then implemented independently using the same validated analytical contracts and approved dashboard design. Power BI source/model files are retained privately; approved report outputs and implementation documentation are provided publicly.

## Results and interpretation

- Adjusted effect: **−1.880 percentage points** (95% CI **−2.564 to −1.196**); lower predicted risk favors intervention.
- GRF prioritization validation is supported within this trial, but superiority over Simple HTE or Baseline Risk is not demonstrated.
- All twelve policy-versus-random gain intervals at prespecified non-full capacities include zero: **no single robust policy winner is established**.
- At full capacity, all policies reconcile to approximately **1.8641 pp** population rollout value, with zero gain versus random. This is a consistency endpoint, not an optimum.

The endpoint is predicted 10-year ASCVD risk, not observed cardiovascular events. Missing outcomes were not imputed; this is an available-primary-outcome analysis according to randomized village assignment. Results are retrospective trial-population evidence, not clinical prescriptions, cost-effectiveness estimates or operational rollout recommendations.

## Explore the dashboard

**Power BI proof:** [read the final five-page report PDF](reports/Cardiovascular_Intervention_Targeting_final.pdf), or view the [final page screenshots and implementation specification](powerbi/PUBLIC_README.md). The report is linked rather than embedded as a reduced-size screenshot.

**Interactive web application:** deployment pending. The live application link will be added after deployment and hosted validation. Local setup is available below.

| Page | Purpose |
| --- | --- |
| Overview | Population, allocation and adjusted average effect |
| Risk vs Benefit | Village baseline risk versus predicted benefit |
| HTE Validation | Prioritization, calibration and descriptive subgroup evidence |
| Rollout | Population value and gain versus random across capacity |
| Robustness | Rankings, overlap, sensitivity and descriptive coverage |

The five pages connect average-effect evidence to benefit validation, hypothetical rollout and robustness. Cloudflare Workers Static Assets is the configured web hosting target.

## Architecture and engineering

Python/R owns scientific estimation; frozen aggregate contracts supply Power BI and the independent web app. A deterministic whitelist exporter produces eleven aggregate datasets plus schemas and a manifest. React owns controls, native tables and page-scoped URL/history state; ECharts owns plots. Same-origin JSON is validated before display. There is no runtime analytical API, database, login or browser-side scientific re-estimation.

### Engineering challenges and solutions

- **Cluster leakage:** whole villages stay together in model-training folds and resampling rather than splitting participants randomly.
- **Reproducible reporting:** deterministic exports, explicit schemas and hash checks keep source precision separate from display rounding.
- **Honest decision support:** point estimates remain paired with uncertainty, supported prioritization is distinguished from superiority, and full rollout is not presented as an optimum.
- **Consistent interaction:** shared controls and navigation preserve page-scoped selectors, URL/history behavior and keyboard access across all five pages.
- **Public delivery:** validated aggregate-only assets support an independent static application without exposing the private trial-working pipeline or editable Power BI model.

The public stack is React 19.3.0, TypeScript 7.0.2, Vite 8.3.2 and ECharts 6.1.0, with Cloudflare static-assets configuration. See [architecture](docs/public/ARCHITECTURE.md) for ownership and state behavior.

## Public repository structure

```text
README.md
docs/public/                 Methods, architecture, decisions and validation
powerbi/PUBLIC_README.md      Public Power BI implementation specification
reports/
  Cardiovascular_Intervention_Targeting_final.pdf
  figures/powerbi/phase12b_final_20261001/   Five final page images
web/
  src/                       Typed React pages, shared controls and charts
  public/data/               Validated aggregate JSON and contracts
  scripts/                   Public validation and retained deeper QA tools
  package.json, package-lock.json, vite.config.ts, wrangler.jsonc
```

## Run locally

Use Node **24.16.0** and npm **11.13.0**. From the repository root in PowerShell:

```powershell
cd web
npm.cmd ci
npm.cmd run data:public:check
npm.cmd run build
npm.cmd run preview
```

Open `http://127.0.0.1:4173/overview`; stop preview with Ctrl+C. Use `npm.cmd run dev` for development. Other shells can use `npm` instead of `npm.cmd`.

The public build needs no private analytical inputs, Power BI installation, secrets or environment variables. No `.env.example` is required. Preview is local, not production deployment.

## Technical documentation

- [Analysis methods and provenance](docs/public/ANALYSIS_METHODS.md)
- [HTE validation](docs/public/HTE_VALIDATION.md)
- [Village rollout and uncertainty](docs/public/ROLLOUT_AND_UNCERTAINTY.md)
- [Architecture](docs/public/ARCHITECTURE.md)
- [Dashboard decisions](docs/public/DASHBOARD_DECISIONS.md)
- [Validation and limitations](docs/public/VALIDATION.md)

Local scientific validation covers 141 reconciliation targets and six data regressions. The public-only build rehearsal serves thirteen JSON assets, five routes and 29 approved build files. These checks do not constitute hosted or accessibility certification.

## Publication and reproducibility boundary

The public React/TypeScript implementation is inspectable and builds from shipped aggregate assets. Publication is selective, not a claim that every local project file is publicly reproducible.

| Material | Public-release treatment |
| --- | --- |
| React/TypeScript source, public-data checks and build configuration | Included as the inspectable application implementation |
| Validated aggregate JSON, schemas and manifest | Included for independent public builds and dashboard exploration |
| Final Power BI PDF, five screenshots and public specification | Included as implementation evidence; editable source remains private |
| Participant-level CSVs, derived working records and private analytical inputs | Excluded to preserve the data/privacy boundary; small file size does not establish publication safety |
| Editable Power BI report/model internals and restricted reference material | Excluded under the approved publication and source-use boundaries |
| Internal implementation plan, decision log, agent instructions and phase records | Retained locally; durable methods, architecture and decisions are curated in the linked public docs instead |
| Backups, intermediate captures, archives and verbose execution logs | Excluded as local recovery/history rather than current public implementation |

Internal planning records are not all inherently confidential: they are excluded primarily to avoid process noise, duplication and stale instructions. Retained scientific regeneration/reconciliation commands require local inputs; they are not public-build prerequisites. Public aggregate JSON already supplies the dashboard's data contract; additional CSV exports are not required to demonstrate the application.

Source study: [BMJ publication](https://doi.org/10.1136/bmj-2024-082765) and [Dryad data record](https://doi.org/10.5061/dryad.tmpg4f58w). Public source-data availability does not imply that all project reproduction inputs are distributed.

Exact Baseline Risk orange **`#F28C00`** is preserved. Its approximately 2.463:1 text contrast on white remains an open accessibility limitation. Screen-reader, physical-device, Firefox/Safari and hosted validation are not claimed. The PDF is untagged; ECharts has a known bundle-size warning.

No open-source LICENSE has been authorized. Public visibility does not grant reuse rights to the private Power BI implementation or other project materials.
