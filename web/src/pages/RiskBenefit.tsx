import { useEffect, useMemo, useState } from 'react';
import type { WebDatasets } from '../data.generated';
import type { usePageNavigation } from '../navigation';
import { loadDatasets } from '../data/load';
import { count, correlation, pp, riskPercent } from '../format';
import { POLICY } from '../metadata';
import { KPIBlock, PageHeader, Panel, Status } from '../components/layout';
import EChart from '../components/charts/EChart';
import { riskBenefitChart, riskBenefitView } from './risk-benefit-chart';
import './risk-benefit.css';

type Inputs = Pick<WebDatasets, 'villages' | 'validation'>;
export default function RiskBenefit({ navigation }: { navigation: ReturnType<typeof usePageNavigation> }) {
  const { signal } = navigation.getState('/risk-vs-benefit');
  const [data, setData] = useState<Inputs>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    loadDatasets(['villages', 'validation']).then(inputs => {
      if (inputs.villages.rows.length) riskBenefitView(inputs.villages.rows, inputs.validation.rows, 'grf');
      if (active) setData(inputs);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const view = useMemo(() => data?.villages.rows.length ? riskBenefitView(data.villages.rows, data.validation.rows, signal) : null, [data, signal]);
  const option = useMemo(() => view ? riskBenefitChart(view, signal) : null, [view, signal]);
  const title = `Baseline Risk vs ${POLICY[signal].label}-Predicted Intervention Benefit`;
  return <div className="risk-benefit">
    <PageHeader title="Risk vs Predicted Benefit" subtitle="Compare village mean baseline risk with frozen out-of-village predicted intervention benefit signals" heading={navigation.heading} />
    {navigation.rejected.length > 0 && <Status kind="notice">Invalid state reset to defaults: {navigation.rejected.join(', ')}.</Status>}
    {error ? <Status kind="error">Unable to load frozen village signals.</Status> : !data ? <Status kind="loading">Loading frozen village signals…</Status> : !view ? <Status kind="empty">No frozen village signals available.</Status> : <>
      <dl className="risk-kpis">
        <KPIBlock label="Randomized village clusters" value={count(view.rows.length)} support="One mark per randomized village" />
        <KPIBlock label={<><span className="policy-name-baseline_risk">Baseline risk</span> range</>} value={<span className="risk-range">{view.ranges[0]}</span>} support="Village mean predicted 10-year ASCVD risk" />
        <KPIBlock label={<><span className="policy-name-grf">GRF</span> benefit range</>} value={<span className="grf-range">{view.ranges[1]}</span>} support="Frozen out-of-village predictions" />
        <KPIBlock label={<><span className="policy-name-simple">Simple HTE</span> benefit range</>} value={<span className="simple-range">{view.ranges[2]}</span>} support="Frozen out-of-village predictions" />
      </dl>
      <div className="risk-body">
        <section className="panel risk-plot" aria-labelledby="risk-plot-heading">
          <div className="risk-plot-header"><div><h2 id="risk-plot-heading"><span className="policy-name-baseline_risk">Baseline Risk</span> vs <span className={`policy-name-${signal}`}>{POLICY[signal].label}</span>-Predicted Intervention Benefit</h2><p>One mark per randomized village; n = {count(view.rows.length)}.</p></div>
            <div className="risk-signals" role="group" aria-label="Benefit signal">
              {(['grf', 'simple'] as const).map(value => <button key={value} type="button" aria-pressed={signal === value} onClick={() => navigation.change('/risk-vs-benefit', { signal: value })}><span className={`policy-name-${value}`}>{POLICY[value].label}</span></button>)}
            </div>
          </div>
          <EChart option={option} title={title} chartId="risk-benefit" description={`127 randomized villages. X: baseline predicted risk (%), fixed 12 to 24%. Y: ${POLICY[signal].label} predicted benefit (pp), fixed 1.0 to 3.5 pp. Explore village values for the same source values available in pointer tooltips.`} />
          <p className="risk-fixed-note">Both signal views use the same fixed axes, so vertical position remains directly comparable when switching between GRF and Simple HTE.</p>
          <details className="risk-point-values" onToggle={event => {
            if (!event.currentTarget.open) {
              const summary = event.currentTarget.querySelector('summary')!;
              summary.focus({ preventScroll: true });
              summary.scrollIntoView({ block: 'nearest' });
            }
          }}><summary>Explore village values</summary>
            <div className="risk-value-scroll" tabIndex={0} role="region" aria-label="All 127 village signal values">
              <table aria-label="Selected village signal values"><colgroup><col style={{ width: '20%' }} /><col style={{ width: '40%' }} /><col style={{ width: '40%' }} /></colgroup><thead><tr><th scope="col">Village ID</th><th scope="col">Baseline risk (%)</th><th scope="col">{POLICY[signal].label} benefit (pp)</th></tr></thead>
                <tbody>{view.rows.map(row => <tr key={row.village_id}><th scope="row">{row.village_id}</th><td>{riskPercent(row.baseline_risk)}</td><td>{pp(row[`${signal}_predicted_benefit`])}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </section>
        <div className="risk-evidence">
          <Panel title="Village-level signal agreement" className="risk-agreement">
            <p className="risk-panel-caption">Pairwise Spearman ρ</p>
            <table aria-label="Village-level signal agreement"><thead><tr><th scope="col">Comparison</th><th scope="col">ρ</th></tr></thead>
              <tbody>{view.correlations.map(pair => <tr key={pair.comparison}><th scope="row"><span className="pair-symbols" aria-hidden="true"><span className={`policy-symbol-${pair.left}`}>●</span><span className={`policy-symbol-${pair.right}`}>●</span></span><span className={`policy-name-${pair.left}`}>{POLICY[pair.left].label}</span> vs <span className={`policy-name-${pair.right}`}>{POLICY[pair.right].label}</span></th><td>{correlation(pair.value)}</td></tr>)}</tbody>
            </table>
          </Panel>
          <Panel title="Key insights" className="risk-insights"><ul>
            <li>Higher baseline risk does not imply greater predicted intervention benefit.</li>
            <li>GRF and Simple HTE predicted intervention benefit signals are moderately correlated but not identical.</li>
            <li>Baseline risk and predicted intervention benefit are related but not interchangeable targeting signals.</li>
          </ul></Panel>
          <Panel title="Plot details" className="risk-details"><ul>
            <li>Each mark represents one randomized village cluster.</li>
            <li>Predicted intervention benefits are frozen out-of-village estimates measured in percentage points.</li>
            <li>Positive values indicate a larger predicted risk reduction.</li>
            <li>Correlations are village-level Spearman rank correlations.</li>
          </ul></Panel>
        </div>
      </div>
    </>}
  </div>;
}
