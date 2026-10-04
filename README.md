# Cardiovascular Intervention Targeting

An end-to-end decision-analytics project: independent Python/R trial analysis, a five-page Power BI dashboard, and a native React/TypeScript web application.

## Problem

High cardiovascular risk does not necessarily imply greater benefit from an intervention. This project asks whether predicted treatment benefit can improve retrospective whole-village prioritization compared with baseline-risk ranking or random selection.

The source is the SMARTER village-cluster randomized trial: **4,533 participants across 127 villages**, with **4,508 observed primary outcomes**.

## Analytical approach

The scientific work preceded the dashboards:

1. Audit source provenance, trial design, variable roles and missing outcomes.
2. Construct the causal cohort and independently reproduce the adjusted average effect.
3. Examine prespecified subgroup interactions and fit Simple HTE and cluster-aware generalized random forest models.
4. Validate predictions out of village using prioritization, calibration and paired comparisons.
5. Aggregate village signals and evaluate hypothetical whole-village rollout.
6. Assess village-bootstrap uncertainty, ranking sensitivity and descriptive coverage.
7. Present validated aggregates in Power BI, then independently implement the native web application.

Python/R owns estimation and validation. Power BI and the web application present the same frozen analytical contracts; the web app is not exported from or embedded in Power BI.

## Key findings

- **Adjusted effect:** −1.880 percentage points (95% CI −2.564 to −1.196); lower predicted risk favors intervention.
- **HTE validation:** GRF prioritization is supported within this trial, but superiority over Simple HTE or Baseline Risk is not demonstrated.
- **Rollout:** all twelve policy-versus-random gain intervals at prespecified non-full capacities include zero. **No single robust policy winner is established.**
- **Full capacity:** all policies reconcile to approximately 1.8641 pp population rollout value, with zero gain versus random—not an identified optimum.

The endpoint is predicted 10-year ASCVD risk, not observed cardiovascular events. Missing outcomes were not imputed. Findings concern available outcomes under randomized village assignment and retrospective scenarios—not individual clinical advice, cost-effectiveness or operational rollout recommendations.

## Dashboard

**Power BI:** [final five-page PDF](reports/Cardiovascular_Intervention_Targeting_final.pdf) · [screenshots and implementation specification](powerbi/PUBLIC_README.md)

**Interactive web app:** deployment pending; the live link will be added after hosted validation.

| Page | Question answered |
| --- | --- |
| Overview | What does the trial show about the average intervention effect? |
| Risk vs Benefit | How does baseline risk relate to predicted village benefit? |
| HTE Validation | Do benefit scores support prioritization, and do comparisons establish superiority? |
| Rollout | How do population value and gain versus random vary with capacity? |
| Robustness | How stable are policy rankings, overlap and descriptive coverage? |

## Architecture and engineering

```text
Trial data → Python/R analysis → validated aggregate contracts
                                ├─ Power BI → final report outputs
                                └─ deterministic JSON export → React/TypeScript + ECharts
```

- **Cluster-aware analysis:** whole villages remain intact in training folds and resampling.
- **Deterministic data contracts:** explicit schemas, generated types and hashes preserve source precision; rounding is presentation-only.
- **Consistent interactions:** shared controls, native tables and page-scoped URL/history state support exploration without recalculating scientific estimates.
- **Static delivery:** thirteen validated JSON assets power the public app without a runtime analytical API, database, login or secrets.

| Engineering challenge | Solution | Verification |
| --- | --- | --- |
| Separating risk burden from causal benefit | Distinct fixed policy signals and qualified comparison results | Source reconciliation and selector checks |
| Keeping two reporting implementations consistent | Frozen aggregate contracts with deterministic exports | Schema, hash and numerical-target checks |
| Preserving usable interactive exploration | Shared navigation, URL state, native tables and readable chart alternatives | Recorded browser/history, sort and responsive checks |

The web uses React, TypeScript, Vite and ECharts. Cloudflare Workers Static Assets is the configured hosting target. Details: [architecture](docs/public/ARCHITECTURE.md) and [dashboard decisions](docs/public/DASHBOARD_DECISIONS.md).

## Repository structure

The current public release contains:

```text
cardiovascular-intervention-targeting/
├── docs/public/              # Scientific methods, architecture and validation
├── powerbi/
│   └── PUBLIC_README.md      # Power BI implementation and final screenshot links
├── reports/
│   ├── Cardiovascular_Intervention_Targeting_final.pdf
│   └── figures/powerbi/      # Five approved final page images
├── web/
│   ├── src/                 # React pages, shared components, charts and state
│   ├── public/data/         # Aggregate JSON, schemas and integrity manifest
│   ├── scripts/             # Data export, validation and regression checks
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   └── wrangler.jsonc
├── .gitignore
└── README.md
```

The scientific Python/R implementation and its root tests are retained locally and are **not yet included in this public release**. Their methodology and findings are documented below.

## Run locally

Use Node **24.16.0** and npm **11.13.0**. From the repository root in PowerShell:

```powershell
cd web
npm.cmd ci
npm.cmd run data:public:check
npm.cmd run build
npm.cmd run preview
```

Open `http://127.0.0.1:4173/overview`. Stop preview with Ctrl+C; use `npm.cmd run dev` for development. Other shells can use `npm` instead of `npm.cmd`.

The public web build requires no participant-level data or Power BI installation. Scientific regeneration and deeper local checks have separate dependencies.

## Methods and validation

- [Analysis methods and provenance](docs/public/ANALYSIS_METHODS.md)
- [HTE validation](docs/public/HTE_VALIDATION.md)
- [Village rollout and uncertainty](docs/public/ROLLOUT_AND_UNCERTAINTY.md)
- [Validation evidence and known limitations](docs/public/VALIDATION.md)

Local data reconciliation passes 141 frozen analytical targets and six web-data exporter regression tests. Public checks validate the shipped data, TypeScript/build and local route/asset serving; recorded browser checks cover selectors, navigation, sorting and responsive interactions. These are not claims of production deployment or accessibility certification.

## Data and publication scope

Source references: [SMARTER publication](https://doi.org/10.1136/bmj-2024-082765) · [Dryad dataset](https://doi.org/10.5061/dryad.tmpg4f58w).

The public application includes reviewed aggregate JSON, not participant-level raw or derived working records. The source dataset is publicly available through Dryad; the complete local scientific pipeline and intermediate outputs are not distributed here.

Editable Power BI report/model files remain private. Internal plans, agent instructions, execution logs and backups stay local; useful technical reasoning is curated in the public documentation.
