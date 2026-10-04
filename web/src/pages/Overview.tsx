import { useEffect, useMemo, useState } from 'react';
import type { Ref } from 'react';
import type { OverviewRow } from '../data.generated';
import { loadDataset } from '../data/load';
import { count, percent, effect } from '../format';
import { KPIBlock, PageHeader, Panel, Status } from '../components/layout';
import EChart from '../components/charts/EChart';
import { effectLabel, effectSummary, overviewChart } from './overview-chart';
import './overview.css';

export default function Overview({ heading }: { heading: Ref<HTMLHeadingElement> }) {
  const [row, setRow] = useState<OverviewRow | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    loadDataset('overview').then(data => { if (active) setRow(data.rows[0] ?? null); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const option = useMemo(() => row ? overviewChart(row) : null, [row]);
  return <div className="overview">
    <PageHeader title="Trial Evidence Overview" subtitle="Randomized-trial population and average effect for village-level prioritization" heading={heading} />
    {error ? <Status kind="error">Unable to load frozen summary.</Status> : row === undefined ? <Status kind="loading">Loading frozen summary…</Status> : row === null ? <Status kind="empty">No frozen summary available.</Status> : <>
      <dl className="overview-kpis">
        <KPIBlock label="Randomized participants" value={count(row.randomized_participants)} support="Randomized trial population" />
        <KPIBlock label="Observed primary outcome" value={count(row.evaluation_participants)} support={`${percent(row.evaluation_participants / row.randomized_participants)} of randomized`} />
        <KPIBlock label="Missing primary outcomes" value={count(row.missing_primary_outcome)} support={`${percent(row.missing_primary_outcome / row.randomized_participants)} of randomized`} />
        <KPIBlock label="Randomized villages" value={count(row.villages)} support={`${count(row.intervention_villages)} intervention • ${count(row.control_villages)} control`} />
      </dl>
      <div className="overview-middle">
        <Panel title="Adjusted Trial Effect" className="overview-effect">
          <p className="effect-value">{effect(row.treatment_effect_estimate).split(' ')[0]} <span>pp</span></p>
          <p className="effect-context">Predicted 10-year ASCVD risk · percentage points</p>
          <p className="effect-direction">Lower predicted risk favors intervention.</p>
        </Panel>
        <Panel title="Adjusted Effect and 95% CI" className="overview-ci">
          <p className="ci-summary">95% CI: {effectLabel(row.treatment_effect_ci_lower)} to {effectLabel(row.treatment_effect_ci_upper)}</p>
          <EChart option={option} title="Adjusted Effect and 95% CI" description={effectSummary(row)} chartId="overview-effect" />
          <p className="ci-caption">Difference in predicted 10-year ASCVD risk (percentage points)</p>
        </Panel>
        <Panel title="Randomized Allocation Summary" className="overview-allocation">
          <table aria-label="Randomized allocation" className="overview-table allocation-table">
            <thead><tr><th scope="col">Arm</th><th scope="col">Participants</th><th scope="col">Villages</th></tr></thead>
            <tbody>
              <tr><th scope="row">Intervention</th><td>{count(row.intervention_participants)}</td><td>{count(row.intervention_villages)}</td></tr>
              <tr><th scope="row">Control</th><td>{count(row.control_participants)}</td><td>{count(row.control_villages)}</td></tr>
              <tr className="total"><th scope="row">Total</th><td>{count(row.randomized_participants)}</td><td>{count(row.villages)}</td></tr>
            </tbody>
          </table>
        </Panel>
      </div>
      <div className="overview-context panel">
        <section aria-labelledby="followup-heading"><h2 id="followup-heading">Primary follow-up completeness</h2>
          <table aria-label="Primary follow-up completeness" className="overview-table completeness-table">
            <thead><tr><th scope="col">Status</th><th scope="col">Participants</th><th scope="col">Share</th></tr></thead>
            <tbody><tr><th scope="row">Observed</th><td>{count(row.evaluation_participants)}</td><td>{percent(row.evaluation_participants / row.randomized_participants)}</td></tr>
              <tr><th scope="row">Missing</th><td>{count(row.missing_primary_outcome)}</td><td>{percent(row.missing_primary_outcome / row.randomized_participants)}</td></tr></tbody>
          </table>
        </section>
        <section aria-labelledby="population-heading"><h2 id="population-heading">Analysis population</h2>
          <ul><li>Available-primary-outcome analysis</li><li>Analyzed according to randomized village assignment</li>
            <li>Participants without primary follow-up outcomes are excluded from the endpoint analysis</li><li>Do not describe as unqualified full ITT</li></ul>
        </section>
        <section aria-labelledby="boundaries-heading"><h2 id="boundaries-heading">Interpretation boundaries</h2>
          <ul><li>Endpoint: Predicted 10-year ASCVD risk, not observed cardiovascular events</li>
            <li>Estimate: Average effect of the multicomponent intervention package</li><li>Use: Not an individual clinical recommendation</li></ul>
        </section>
      </div>
    </>}
  </div>;
}
