import { useEffect, useMemo, useState } from 'react';
import type { WebDatasets } from '../data.generated';
import type { usePageNavigation } from '../navigation';
import { loadDatasets } from '../data/load';
import { anchors, policies, POLICY } from '../metadata';
import { count, decimal, pp, percent, ci } from '../format';
import { KPIBlock, PageHeader, Panel, Status } from '../components/layout';
import { TableViewport } from '../components/DataTable';
import EChart from '../components/charts/EChart';
import { rolloutView, rolloutChart } from './rollout-view';
import './rollout.css';

type Inputs = Pick<WebDatasets, 'rollout' | 'anchors' | 'overview'>;
function AnchorSymbol({ policy, hollow = false }: { policy: keyof typeof POLICY; hollow?: boolean }) {
  const shape = policy === 'grf' ? <circle cx="6" cy="6" r="4" /> : policy === 'simple' ? <rect x="2" y="2" width="8" height="8" />
    : <polygon points={policy === 'baseline_risk' ? '6,1 11,10 1,10' : '6,1 11,6 6,11 1,6'} />;
  return <svg className="rollout-marker" viewBox="0 0 12 12" aria-hidden="true" fill={hollow ? '#fff' : POLICY[policy].color} stroke={POLICY[policy].color} strokeWidth={hollow ? 2 : 1}>{shape}</svg>;
}
export default function Rollout({ navigation }: { navigation: ReturnType<typeof usePageNavigation> }) {
  const state = navigation.getState('/rollout');
  const [data, setData] = useState<Inputs>();
  const [error, setError] = useState(false);
  const [inspectK, setInspectK] = useState(64);
  useEffect(() => {
    let active = true;
    loadDatasets(['rollout', 'anchors', 'overview']).then(inputs => {
      if (inputs.rollout.rows.length) rolloutView(inputs.rollout.rows, inputs.anchors.rows, inputs.overview.rows, { policy: 'simple', k: 64 });
      if (active) setData(inputs);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const view = useMemo(() => data?.rollout.rows.length ? rolloutView(data.rollout.rows, data.anchors.rows, data.overview.rows, state) : null, [data, state]);
  const options = useMemo(() => view && data ? { value: rolloutChart(data.rollout.rows, state, 'value'), gain: rolloutChart(data.rollout.rows, state, 'gain') } : null, [data, view, state]);
  const selected = view?.selected;
  return <div className="rollout">
    <PageHeader title="Rollout Across Capacity" subtitle="Compare frozen whole-village rollout policies across capacity with pointwise uncertainty." heading={navigation.heading}>
      <div className="rollout-controls"><p>Explore rollout scenarios</p><div className="rollout-control-groups">
        <fieldset><legend>Focused policy</legend><div>{policies.map(policy => <button key={policy} type="button" disabled={!view} aria-pressed={state.policy === policy} onClick={() => navigation.change('/rollout', { policy })}><span className={`policy-name-${policy}`}>{POLICY[policy].label}</span></button>)}</div></fieldset>
        <fieldset><legend>Capacity anchor (randomized villages)</legend><div>{anchors.map(k => <button key={k} type="button" aria-label={`${k} villages`} disabled={!view} aria-pressed={state.k === k} onClick={() => navigation.change('/rollout', { k })}>{k}</button>)}</div></fieldset>
      </div><p className="rollout-default">Default: Simple HTE · K=64 (starting view, not a recommendation).</p></div>
    </PageHeader>
    {navigation.rejected.length > 0 && <Status kind="notice">Invalid state reset to defaults: {navigation.rejected.join(', ')}.</Status>}
    {error ? <Status kind="error">Unable to load frozen rollout evidence.</Status> : !data ? <Status kind="loading">Loading frozen rollout evidence…</Status> : !view || !selected || !options ? <Status kind="empty">No frozen rollout evidence available.</Status> : <>
      <dl className="rollout-kpis" aria-label="Selected rollout results" aria-live="polite">
        <KPIBlock label="Selected villages" value={count(selected.selected_villages)} support={`of ${count(view.villagesTotal)} randomized villages`} />
        <KPIBlock label="Randomized participants covered" value={count(selected.n_selected_randomized)} support={`${percent(selected.randomized_coverage)} of ${count(view.randomizedTotal)}`} />
        <KPIBlock label="Population rollout value" value={pp(selected.point_population_rollout_value, 4)} support={`Pointwise 95% interval: ${ci(selected.population_value_ci_lower, selected.population_value_ci_upper, 4)}`} />
        <KPIBlock label="Gain versus random" value={pp(selected.point_gain_vs_random, 4, true)} support={`Pointwise 95% interval: ${ci(selected.gain_ci_lower, selected.gain_ci_upper, 4)}`} />
      </dl>
      <div className="rollout-charts">{(['value', 'gain'] as const).map(kind => <Panel key={kind} title={kind === 'value' ? 'Population Rollout Value Across Capacity' : 'Gain Versus Random Allocation Across Capacity'} className="rollout-chart-panel">
        <p className="rollout-caption">{kind === 'value' ? 'Participant-weighted predicted-risk reduction with pointwise 95% intervals' : 'Policy rollout value minus random-allocation expectation; pointwise 95% intervals'}</p>
        <EChart option={options[kind]} title={kind === 'value' ? 'Population rollout value' : 'Gain versus random'} chartId={`rollout-${kind}`}
          description={`All three policies across K=0–127. Percentage points; fixed scale ${kind === 'value' ? '−0.2 to 2.8' : '−0.6 to 0.8'}. Shading: ${POLICY[state.policy].label} pointwise 95% CI; selected K=${state.k}. Explore chart values for keyboard-accessible comparison at every capacity.`} />
        <div className="rollout-legend" aria-label="Chart legend">{policies.map(policy => <span key={policy}><span className={`rollout-line rollout-line-${policy}`} aria-hidden="true" /><AnchorSymbol policy={policy} /><span className={`policy-name-${policy}`}>{POLICY[policy].label}{kind === 'gain' ? ' vs random' : ''}</span></span>)}<span><span className="rollout-line rollout-line-random" aria-hidden="true" />{kind === 'value' && <AnchorSymbol policy="random" />}{kind === 'value' ? 'Random expectation' : 'Zero-gain reference'}</span></div>
        <div className="rollout-legend rollout-marker-legend" aria-label="Uncertainty and anchor legend">
          <span><span className="rollout-band" style={{ background: POLICY[state.policy].color }} aria-hidden="true" />Selected-policy 95% CI</span>
          <span><AnchorSymbol policy={state.policy} hollow />Selected anchor</span>
          <span><span className="rollout-capacity-key" aria-hidden="true" />Selected capacity</span>
          <span>{policies.map(policy => <AnchorSymbol key={policy} policy={policy} />)}{kind === 'value' && <AnchorSymbol policy="random" />}Prespecified anchors</span>
        </div>
        <p className="rollout-chart-note">{kind === 'value' ? `Pointwise 95% CIs use ${count(selected.bootstrap_replicates)} village-bootstrap replicates. K=127: all policies converge to ${pp(data.rollout.rows.find(r => r.policy === 'grf' && r.capacity_villages === 127)!.point_population_rollout_value, 4)}.` : 'All 12 prespecified gain intervals at K=13, 32, 64 and 95 include zero; K=127 is reconciliation, not an optimum.'}</p>
      </Panel>)}</div>
      <div className="rollout-bottom">
        <Panel title="Fixed-Capacity Evidence Matrix" className="rollout-matrix"><p className="rollout-caption">Population rollout value (pp) at prespecified anchors</p>
          <div className="rollout-matrix-scroll" tabIndex={0} role="region" aria-label="Fixed anchor values"><table aria-label="Fixed-capacity rollout evidence"><thead><tr><th scope="col">Policy</th>{anchors.map(k => <th key={k} scope="col" aria-current={state.k === k ? 'true' : undefined} className={state.k === k ? 'selected-anchor' : ''}>K = {k}{k === 127 ? ' Endpoint' : ''}{state.k === k ? ' Selected' : ''}</th>)}</tr></thead>
            <tbody>{view.matrix.map(row => <tr key={row.policy}><th scope="row"><span className={`policy-name-${row.policy}`}><span className={`rollout-symbol rollout-symbol-${row.policy}`} aria-hidden="true">{POLICY[row.policy].symbol}</span>{row.label}</span></th>{row.values.map((value, i) => <td key={anchors[i]} className={state.k === anchors[i] ? 'selected-anchor' : ''}>{decimal(value, 4)}</td>)}</tr>)}</tbody>
          </table></div><p className="rollout-chart-note">Random expectation is reference context, not a selectable rollout policy.</p>
        </Panel>
        <Panel title="Coverage at Selected Capacity" className="rollout-coverage"><p className="rollout-caption"><span className={`policy-name-${state.policy}`}>{POLICY[state.policy].label}</span> / {state.k} randomized villages</p>
          {[{ label: 'Randomized participant coverage', fraction: selected.randomized_coverage, covered: selected.n_selected_randomized, total: view.randomizedTotal }, { label: 'Village coverage', fraction: selected.selected_villages / view.villagesTotal, covered: selected.selected_villages, total: view.villagesTotal }].map(row => <div className="rollout-coverage-row" key={row.label}>
            <h3>{row.label}</h3><div className="rollout-coverage-bar" aria-label={`${row.label}: ${percent(row.fraction)}`}><span style={{ width: `${row.fraction * 100}%` }}>{row.fraction > .15 && percent(row.fraction)}</span><span style={{ width: `${(1 - row.fraction) * 100}%` }}>{row.fraction < .85 && percent(1 - row.fraction)}</span></div>
            <div className="rollout-coverage-counts"><span>{count(row.covered)} of {count(row.total)}{row.fraction <= .15 && ` (${percent(row.fraction)})`}</span><span>{row.label === 'Village coverage' ? 'Remaining' : 'Not covered'}: {count(row.total - row.covered)}</span></div>
          </div>)}
          <p className="rollout-chart-note">Observed-outcome evaluation coverage: {count(selected.n_selected_evaluation)} of {count(view.evaluationTotal)} participants ({percent(selected.evaluation_coverage)}). Whole randomized villages remain the capacity unit.</p>
        </Panel>
      </div>
      <details className="rollout-explore" onToggle={event => { if (!event.currentTarget.open) { const summary = event.currentTarget.querySelector('summary')!; summary.focus({ preventScroll: true }); summary.scrollIntoView({ block: 'nearest' }); } }}><summary>Explore chart values</summary>
        <div className="rollout-inspection"><label>Inspect chart capacity <input type="range" aria-label="Inspect chart capacity" min={0} max={127} step={1} value={inspectK} onChange={event => setInspectK(Number(event.target.value))} /></label><p role="status">Chart detail: K={inspectK}. Selected policy: {POLICY[state.policy].label}; selected capacity: {state.k}. Inspection does not change selections.</p>
          <TableViewport label="Rollout comparison values"><table><caption>Source values at inspected capacity K={inspectK}; values and pointwise 95% intervals in pp</caption><thead><tr><th scope="col">Policy</th><th scope="col">Covered participants</th><th scope="col">Rollout value</th><th scope="col">95% CI</th><th scope="col">Gain vs random</th><th scope="col">95% CI</th></tr></thead><tbody>{policies.map(policy => { const row = data.rollout.rows.find(r => r.policy === policy && r.capacity_villages === inspectK)!; return <tr key={policy}><th scope="row"><span className={`policy-name-${policy}`}>{POLICY[policy].label}</span></th><td>{count(row.n_selected_randomized)}</td><td>{pp(row.point_population_rollout_value, 4)}</td><td>{ci(row.population_value_ci_lower, row.population_value_ci_upper, 4)}</td><td>{pp(row.point_gain_vs_random, 4, true)}</td><td>{ci(row.gain_ci_lower, row.gain_ci_upper, 4)}</td></tr>; })}</tbody></table></TableViewport>
          <p>Random expectation: {pp(data.rollout.rows.find(r => r.policy === 'grf' && r.capacity_villages === inspectK)!.point_random_expected_value, 4)}.</p>
        </div>
      </details>
    </>}
  </div>;
}
