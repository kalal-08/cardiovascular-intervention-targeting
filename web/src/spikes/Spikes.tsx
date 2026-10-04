import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Page5State, SortField } from '../contract';
import type { VillagesRow } from '../data.generated';
import { anchors, colors, defaults, dimensions, focusRank, frozenKPIs, labels, policies, selectedPanels, sortVillages, symbols } from './state';
import type { SpikeData } from './state';
import { loadData } from './data';
import { usePageNavigation } from '../navigation';
import { decimal, count } from '../format';
import { TableViewport, SortHeader } from '../components/DataTable';
import { SelectControl } from '../components/controls';
import { Panel, KPIBlock, Status } from '../components/layout';
import Charts from './Charts';
import './spikes.css';

const SPIKE_PATHS = { '/rollout': '/__spikes/page4', '/robustness': '/__spikes/page5' } as const;
export default function Spikes() {
  const navigation = usePageNavigation(SPIKE_PATHS);
  const page = navigation.route === '/rollout' ? 'page4' : 'page5';
  const state = { ...defaults, ...navigation.getState(page === 'page4' ? '/rollout' : '/robustness') };
  const { rejected } = navigation;
  const [data, setData] = useState<SpikeData>();
  const [error, setError] = useState('');
  useEffect(() => { let active = true; loadData().then(value => { if (active) setData(value); }).catch(() => { if (active) setError('Validated public data is unavailable. Reload after resolving the data error.'); }); return () => { active = false; }; }, []);
  function change(patch: Partial<Page5State>) { navigation.change(page === 'page4' ? '/rollout' : '/robustness', patch); }
  const panels = data ? selectedPanels(data, state) : undefined;
  return <main className="spike" id="content">
    <nav aria-label="Feasibility spikes">{(['page4', 'page5'] as const).map(target => <a key={target} href={navigation.href(target === 'page4' ? '/rollout' : '/robustness')} onClick={event => navigation.navigate(event, target === 'page4' ? '/rollout' : '/robustness')} aria-current={page === target ? 'page' : undefined}>{target === 'page4' ? 'Page 4 spike' : 'Page 5 spike'}</a>)}<a href={`/__spikes/${page}`}>Open default state</a><a href="/overview">Report foundation</a></nav>
    <h1 ref={navigation.heading} tabIndex={-1}>{page === 'page4' ? 'Rollout chart feasibility' : 'Ranking and selector feasibility'}</h1>
    <p>Internal 12C.3 harness. Functional evidence; final page design is pending.</p>
    {rejected.length > 0 && <Status kind="notice">Invalid state reset to defaults: {rejected.join(', ')}.</Status>}
    {error ? <Status kind="error">{error}</Status> : !panels || !data ? <Status kind="loading">Loading validated data…</Status> : <>
      <div className="spike-controls"><SelectControl label="Focused policy" value={state.policy} options={policies.map(policy => ({ value: policy, label: labels[policy] }))} onChange={policy => change({ policy })} />
        <SelectControl label="Capacity anchor" value={state.k} options={anchors.map(k => ({ value: k, label: String(k) }))} onChange={k => change({ k })} /></div>
      <p className="state-summary">{labels[state.policy]} · K={state.k}{page === 'page5' ? ` · ${dimensions[state.dimension]} · Sort: ${state.sort} ${state.direction}` : ''}</p>
      {page === 'page4' ? <>
        <dl className="spike-kpis" aria-label="Selected rollout values">
          <div><dt>Population rollout value</dt><dd data-testid="rollout-value">{decimal(panels.anchor.point_population_rollout_value, 4)} pp</dd><small>95% CI {decimal(panels.anchor.population_value_ci_lower, 4)} to {decimal(panels.anchor.population_value_ci_upper, 4)} pp</small></div>
          <div><dt>Gain vs random</dt><dd data-testid="gain-value">{decimal(panels.anchor.point_gain_vs_random, 4)} pp</dd><small>95% CI {decimal(panels.anchor.gain_ci_lower, 4)} to {decimal(panels.anchor.gain_ci_upper, 4)} pp</small></div>
          <div><dt>Randomized participants covered</dt><dd data-testid="covered-value">{count(panels.anchor.n_selected_randomized)} / 4,533</dd><small>{decimal(100 * panels.anchor.randomized_coverage, 1)}%</small></div>
        </dl><Charts data={data} state={state} />
      </> : <>
        <dl className="spike-kpis" aria-label="Frozen study findings">{frozenKPIs(data).map((value, index) => <KPIBlock key={index} label={['Trial villages', 'Lowest agreement (K=64)', 'Gain intervals including zero', 'Ranking-sensitive policies'][index]} value={value} />)}</dl>
        <Rankings data={data} state={state} change={change} />
        <div className="spike-details">
          <Panel id="overlap-title" title={`Policy Overlap at K=${state.k}`}><p>Jaccard agreement · common 0–1 scale</p><table data-testid="overlap"><thead><tr><th>Policy pair</th><th>Agreement</th><th>Shared</th></tr></thead><tbody>{panels.overlap.map(row => <tr key={row.comparison}><th scope="row">{labels[row.policy_left]} vs {labels[row.policy_right]}</th><td>{decimal(row.jaccard_overlap * 100, 1)}%</td><td>{row.shared_villages}</td></tr>)}</tbody></table><p>Set agreement, not causal performance.</p></Panel>
          <Panel id="robustness-title" title="Robustness at Selected Capacity"><p>{labels[state.policy]} · K={state.k}</p>
            {!panels.robustness ? <p data-testid="reconciliation">Not applicable — full-capacity reconciliation</p> : <div data-testid="robustness">
              <p>{decimal(panels.robustness.phase11a_point_gain_vs_random, 4)} pp · No clear capacity-specific advantage</p>
              <p>Pointwise 95% CI: {decimal(panels.robustness.phase11a_gain_ci_lower, 4)} to {decimal(panels.robustness.phase11a_gain_ci_upper, 4)} pp</p>
              <table><thead><tr><th>Check</th><th>Finding</th></tr></thead><tbody><tr><th>Raw ranking</th><td>{panels.robustness.raw_ranking_stability}</td></tr><tr><th>Equal village</th><td>{panels.robustness.equal_village_consistency}</td></tr><tr><th>Single-village influence</th><td>{panels.robustness.single_village_influence}</td></tr></tbody></table>
              <p>Sensitivity checks do not establish an advantage.</p></div>}
          </Panel>
          <Panel id="coverage-title" title={`Descriptive Coverage by ${dimensions[state.dimension]}`}>
            <SelectControl label="Coverage dimension" value={state.dimension} options={Object.entries(dimensions).map(([key, label]) => ({ value: key as Page5State['dimension'], label }))} onChange={dimension => change({ dimension })} />
            <p data-testid="overall">Covered: {count(panels.anchor.n_selected_randomized)} / 4,533 · Overall {decimal(panels.anchor.randomized_coverage * 100, 1)}%</p>
            <TableViewport label="Coverage groups"><table data-testid="coverage"><thead><tr><th>Group</th><th>Coverage</th><th>Covered / total</th><th>Gap</th></tr></thead><tbody>{panels.coverage.map(row => <tr key={row.category}><th scope="row">{row.category}</th><td>{decimal(row.subgroup_coverage * 100, 1)}%</td><td>{count(row.n_subgroup_covered)} / {count(row.n_subgroup_total)}</td><td>{decimal(row.coverage_gap * 100, 1)} pp</td></tr>)}</tbody></table></TableViewport><p>Descriptive coverage; not a fairness target.</p>
          </Panel>
        </div>
      </>}
    </>}
  </main>;
}
function Rankings({ data, state, change }: { data: SpikeData; state: Page5State; change: (patch: Partial<Page5State>) => void }) {
  const previous = useRef<readonly VillagesRow[]>(data.villages.rows);
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => sortVillages(previous.current, state), [state.policy, state.sort, state.direction]);
  useLayoutEffect(() => { previous.current = rows; viewport.current!.scrollTop = 0; }, [rows]);
  const columns: [SortField, string][] = [['village', 'Village ID'], ['focus', 'Focus rank'], ['grfRank', 'Rank'], ['grfBenefit', 'Predicted benefit (pp)'], ['simpleRank', 'Rank'], ['simpleBenefit', 'Predicted benefit (pp)'], ['baselineRank', 'Rank'], ['baselineRisk', 'Predicted risk (%)'], ['participants', 'Participants']];
  return <Panel title="Candidate Village Rankings"><p>Click Focus rank for policy order. Active sort: {columns.find(([field]) => field === state.sort)![1]} {state.direction === 'asc' ? '↑' : '↓'}</p>
    <TableViewport className="rank-scroll" viewport={viewport} label="All 127 village rankings">
      <table className="rank-table" data-testid="rankings"><caption className="sr-only">Three separate policy rankings. All numeric columns sort complete village rows.</caption>
        <thead><tr><th colSpan={2} scope="colgroup">Village</th>{policies.map(policy => <th key={policy} colSpan={2} scope="colgroup" data-policy={policy} className={state.policy === policy ? 'selected-policy' : ''}><span style={{ color: colors[policy] }}>{symbols[policy]}</span> {labels[policy]}</th>)}<th scope="colgroup">Population</th></tr>
          <tr>{columns.map(([field, label], index) => <SortHeader key={field} field={field} label={label}
            accessibleLabel={`${index >= 2 && index <= 7 ? labels[policies[Math.floor((index - 2) / 2)]] + ' ' : ''}${label}`}
            direction={state.sort === field ? state.direction : undefined} className={field === 'focus' ? 'focus-rank' : ''}
            onSort={() => change({ sort: field, direction: state.sort === field && state.direction === 'asc' ? 'desc' : 'asc' })} />)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.village_id} data-village={row.village_id}><th scope="row">{row.village_id}</th><td className="focus-rank">{focusRank(row, state.policy)}</td>{policies.map(policy => <PolicyCells key={policy} row={row} policy={policy} selected={policy === state.policy} />)}<td>{row.n_randomized}</td></tr>)}</tbody>
      </table>
    </TableViewport><p>Policy changes Focus rank and highlight. Click headers to sort whole rows; policy signals stay fixed.</p>
  </Panel>;
}
function PolicyCells({ row, policy, selected }: { row: VillagesRow; policy: Page5State['policy']; selected: boolean }) {
  return <><td className={selected ? 'selected-policy' : ''}>{focusRank(row, policy)}</td><td className={selected ? 'selected-policy' : ''}>{policy === 'baseline_risk' ? decimal(row.baseline_risk, 2) : decimal(row[`${policy}_predicted_benefit`], 3)}</td></>;
}
