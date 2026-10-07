# Cardiovascular Intervention Targeting

From randomized-trial evidence to whole-village decision analytics: independent Python/R analysis, a five-page Power BI report, and an interactive React/TypeScript dashboard.

**[Live Dashboard](https://cit-dashboard.urvilkalal07.workers.dev/overview)** · **[Power BI Report](reports/Cardiovascular_Intervention_Targeting_final.pdf)** · **[Technical Docs](docs/public/ARCHITECTURE.md)**

Python · R / GRF · Power BI · React · TypeScript · ECharts · Cloudflare

**4,533 participants** · **127 randomized villages** · **5 dashboard pages** · **13 public JSON assets**

## From evidence to application

```text
SMARTER data (acquired separately)
  → Python/R analysis + whole-village validation
  → Frozen aggregate contracts
      ├─ Power BI → report PDF + Desktop proof
      └─ Public JSON + schemas, types and hashes
           → React/ECharts → Cloudflare → live dashboard
```

Python/R computes the estimates. Power BI and the native web app are independent reporting layers—not an embedded or exported Power BI website.

## Problem

High cardiovascular risk does not necessarily imply greater intervention benefit. Can predicted benefit improve retrospective village prioritization compared with baseline-risk ranking or random selection?

The SMARTER trial has **4,508 observed primary outcomes** and **25 missing outcomes**. Whole villages remain intact in validation and rollout. Metrics distinguish average effect, prioritization, rollout value and gain versus random.

## Results

- **Average effect:** −1.880 percentage points (95% CI −2.564 to −1.196), favoring intervention.
- **Prioritization:** GRF AUTOC is 0.6382 (95% CI 0.1131 to 1.1634), supporting prioritization within this trial but not superiority over the benchmarks.
- **Capacity example:** Simple HTE at 64 villages covers 2,299 participants (50.7%); population value is 1.0784 pp. Gain versus random is +0.1390 pp (95% CI −0.2353 to +0.5103), not a demonstrated advantage.
- **No robust winner:** all twelve non-full-capacity gain intervals include zero. Full capacity reconciles to 1.8641 pp and zero gain—not an optimal cutoff.

The endpoint is **predicted 10-year ASCVD risk**, not observed events. Adjusted effect and rollout value are different estimators. Outcomes were not imputed: this is available-primary-outcome analysis, not unqualified full ITT.

## Explore the five pages

| Page | Question |
| --- | --- |
| Overview | Average effect, allocation and outcome completeness |
| Risk vs Benefit | Baseline risk versus predicted village benefit |
| HTE Validation | Prioritization, calibration and comparative evidence |
| Rollout | Population value and gain across whole-village capacities |
| Robustness | Rankings, overlap, sensitivity and descriptive coverage |

See the [Power BI guide and gallery](powerbi/PUBLIC_README.md) and [Desktop proof PDF](reports/CIT-PowerBI-Proof.pdf). Captures document recorded states; the web app provides interactive exploration.

## Engineering decisions and evidence

| Challenge | Implementation | Evidence |
| --- | --- | --- |
| Causal leakage | Whole-village folds; pre-treatment allowlist | [Scientific methods](docs/public/ANALYSIS_METHODS.md) |
| Reporting consistency | Frozen contracts; typed, whitelisted exports | 141/141 targets; six exporter regressions |
| Exploration state | URL/history selectors; stable charts and Village-ID selection | [Interaction decisions](docs/public/DASHBOARD_DECISIONS.md) |
| Foreground loading | Concurrent route code/data; verified caches with retry recovery | [Local regression evidence](docs/public/VALIDATION.md#foreground-loading--2026-10-07) |
| Static delivery | Same-origin aggregates; no analytical API or database | Five routes, thirteen JSON and fifteen JS/CSS assets checked; [scope](docs/public/VALIDATION.md) |

Layout uses viewport-aware spacing and container-sized charts. Dense pages intentionally scroll; universal screen fit is not claimed. See [viewport decisions](docs/public/DASHBOARD_DECISIONS.md#viewport-adaptation).

## Run the web application locally

Use **Node 24.16.0** and **npm 11.13.0**. From the repository root in PowerShell:

```powershell
cd web
npm.cmd ci
npm.cmd run data:public:check
npm.cmd run build
npm.cmd run preview
```

Open [localhost Overview](http://127.0.0.1:4173/overview). Stop with Ctrl+C; use `npm.cmd run dev` for development. Other shells can use `npm`.

The web build needs no raw data, Power BI or cloud credentials. Follow [scientific reproduction](docs/public/ANALYSIS_METHODS.md#scientific-reproduction) separately; preserve supplied release outputs.

## Repository structure

```text
cardiovascular-intervention-targeting/
├── src/intervention_targeting/ # Python analysis and policy evaluation
├── r/                         # Cluster-aware GRF and RATE validation
├── tests/                     # Science and publication-boundary checks
├── scripts/run_analysis.py    # Ordered scientific regeneration
├── data/derived/              # Eight reviewed aggregate CSVs
├── renv/                      # R bootstrap and settings
├── renv.lock                  # R dependency lock
├── pyproject.toml             # Python requirements and test configuration
├── web/
│   ├── src/                   # Pages, components, plots and state
│   ├── public/data/           # Aggregate JSON, schemas and manifest
│   ├── scripts/               # Export and regression checks
│   └── package-lock.json      # Pinned web dependency tree
├── docs/public/               # Methods, architecture and validation
├── powerbi/PUBLIC_README.md    # Report guide and evidence gallery
├── reports/                   # Report PDF, Desktop proof and page images
└── README.md
```

## Methods and validation

- [Analysis methods, source provenance and reproduction](docs/public/ANALYSIS_METHODS.md)
- [HTE evaluation and interpretation](docs/public/HTE_VALIDATION.md)
- [Rollout, bootstrap uncertainty and sensitivities](docs/public/ROLLOUT_AND_UNCERTAINTY.md)
- [Verification evidence and known limitations](docs/public/VALIDATION.md)

## Data and interpretation boundaries

Sources: [SMARTER publication](https://doi.org/10.1136/bmj-2024-082765) · [Dryad dataset](https://doi.org/10.5061/dryad.tmpg4f58w).

Public: scientific source, eight aggregate CSVs and web assets. Excluded: participant-level records, editable Power BI models, internal records, caches and credentials.

Inference is limited by 127 clusters; rollout intervals are pointwise and conditional on frozen models/policies. Coverage is descriptive, not a fairness target. No clinical advice, geographic transportability, operational advantage, cost-effectiveness or optimal-capacity claim is supported.
