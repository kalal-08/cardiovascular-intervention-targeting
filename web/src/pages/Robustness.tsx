import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import type { Page5State, SortField } from '../contract';
import type { VillagesRow } from '../data.generated';
import type { usePageNavigation } from '../navigation';
import { loadDatasets } from '../data/load';
import { frozenKPIs } from '../data/selectors';
import { focusRank, sortVillages } from '../state';
import { anchors, dimensions, policies, POLICY } from '../metadata';
import { ci, count, decimal, percent, pp } from '../format';
import { KPIBlock, PageHeader, Panel, Status } from '../components/layout';
import { SortHeader, TableViewport } from '../components/DataTable';
import { SelectControl } from '../components/controls';
import { coverageLabel, gainPosition, page5View, sensitivityFindings, validatePage5 } from './robustness-view';
import type { Page5Inputs } from './robustness-view';
import './robustness.css';

const columns: readonly [SortField, string, string][] = [
  ['village', 'Village ID', 'Village ID'], ['focus', 'Focus rank', 'Focus rank'],
  ['grfRank', 'Rank', 'GRF rank'], ['grfBenefit', 'Predicted benefit (pp)', 'GRF predicted benefit (pp)'],
  ['simpleRank', 'Rank', 'Simple HTE rank'], ['simpleBenefit', 'Predicted benefit (pp)', 'Simple HTE predicted benefit (pp)'],
  ['baselineRank', 'Rank', 'Baseline Risk rank'], ['baselineRisk', 'Predicted risk (%)', 'Baseline Risk predicted risk (%)'],
  ['participants', 'Participants', 'Participants'],
];
const DetailContext = createContext<{ active: string | null; setActive: (value: string | null | ((current: string | null) => string | null)) => void }>({ active: null, setActive: () => {} });
function PolicyName({ policy }: { policy: Page5State['policy'] }) {
  return <span className={`policy-name-${policy}`}><span className={`p5-symbol p5-symbol-${policy}`} aria-hidden="true">{POLICY[policy].symbol}</span>{POLICY[policy].label}</span>;
}
function ReadDetail({ label, detail, children, className = '' }: { label: string; detail: ReactNode; children: ReactNode; className?: string }) {
  const id = useId(), anchor = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const { active, setActive } = useContext(DetailContext), open = active === id;
  const setOpen = (value: boolean) => setActive(current => value ? id : current === id ? null : current);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const marker = anchor.current.querySelector('.p5-estimate-marker');
    const a = (marker || anchor.current).getBoundingClientRect(), b = tip.current.getBoundingClientRect();
    const right = a.right + 10;
    const left = marker ? right + b.width <= innerWidth - 8 ? right : a.left - b.width - 10 : a.left + (a.width - b.width) / 2;
    const top = a.top - b.height - 10;
    tip.current.style.left = `${Math.max(8, Math.min(left, innerWidth - b.width - 8))}px`;
    tip.current.style.top = `${Math.max(8, Math.min(top, innerHeight - b.height - 8))}px`;
  }, [open, detail]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) dismiss(); };
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  return <div ref={anchor} className={`p5-read ${className}`} tabIndex={0} aria-label={label} aria-describedby={open ? id : undefined}
    onMouseEnter={() => {
      clearTimeout(leaveTimer.current);
      // Closing a raised detail must not let the uncovered row steal keyboard focus's detail.
      const focused = document.activeElement?.closest('.p5-read');
      if (!focused || focused === anchor.current) setOpen(true);
    }} onMouseLeave={() => {
      if (!anchor.current?.contains(document.activeElement)) leaveTimer.current = setTimeout(() => setOpen(false), 140);
    }}
    onFocus={() => { clearTimeout(leaveTimer.current); setOpen(true); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onClick={() => { clearTimeout(leaveTimer.current); setOpen(true); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
    {children}{open && <div id={id} ref={tip} role="tooltip" className="p5-detail">{detail}</div>}
  </div>;
}
function Rankings({ villages, state, change }: { villages: readonly VillagesRow[]; state: Page5State; change: (patch: Partial<Page5State>) => void }) {
  const previous = useRef(villages), viewport = useRef<HTMLDivElement>(null);
  const [selectedVillage, setSelectedVillage] = useState<string | null>(null);
  // Preserve prior complete-row order for equal sort keys; K/dimension never enter this dependency list.
  const rows = useMemo(() => sortVillages(previous.current, state), [villages, state.policy, state.sort, state.direction]);
  useLayoutEffect(() => { previous.current = rows; if (viewport.current) viewport.current.scrollTop = 0; }, [rows]);
  return <Panel title="Candidate Village Rankings" className="p5-ranking-panel">
    <div className="p5-rank-caption"><span>Three separate policy rankings.</span><span>Click Focus rank for policy order.</span></div>
    <TableViewport label="All 127 village rankings" className="p5-rank-scroll" viewport={viewport}>
      <table className="p5-rankings"><caption className="sr-only">All 127 villages. Active sort: {columns.find(([field]) => field === state.sort)![2]}, {state.direction === 'asc' ? 'ascending' : 'descending'}. Policy changes retain the chosen sort. Click a row or activate its village button to highlight it. Click again or press Escape to clear. Highlighting does not filter other panels.</caption>
        <colgroup>{[8, 10, 6, 15, 6, 15, 6, 15, 9].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
        <thead><tr><th colSpan={2} scope="colgroup" className="p5-attribute"><span className="sr-only">Village attributes</span></th>
          {policies.map(policy => <th key={policy} colSpan={2} scope="colgroup" data-policy={policy} className={state.policy === policy ? 'selected-policy' : ''}><PolicyName policy={policy} /></th>)}
          <th scope="col" className="p5-attribute"><span className="sr-only">Population</span></th></tr>
          <tr>{columns.map(([field, label, accessibleLabel], index) => <SortHeader key={field} field={field} label={label} accessibleLabel={accessibleLabel}
            direction={state.sort === field ? state.direction : undefined}
            className={field === 'focus' ? 'p5-focus' : field === 'village' || field === 'participants' ? 'p5-attribute' : policies[Math.floor((index - 2) / 2)] === state.policy ? 'selected-policy' : ''}
            onSort={() => change({ sort: field, direction: state.sort === field && state.direction === 'asc' ? 'desc' : 'asc' })} />)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.village_id} data-village={row.village_id} data-selected={selectedVillage === row.village_id}
          onClick={event => { setSelectedVillage(current => current === row.village_id ? null : row.village_id); event.currentTarget.querySelector('button')?.focus({ preventScroll: true }); }}
          onKeyDown={event => { if (event.key === 'Escape') { setSelectedVillage(null); event.stopPropagation(); } }}>
          <th scope="row"><button type="button" aria-label={`Select village ${row.village_id}`} aria-pressed={selectedVillage === row.village_id}>{row.village_id}</button></th><td className="p5-focus">{focusRank(row, state.policy)}</td>
          {policies.map(policy => <PolicyCells key={policy} row={row} policy={policy} selected={policy === state.policy} />)}<td>{row.n_randomized}</td></tr>)}</tbody>
      </table>
    </TableViewport>
    <p className="p5-rank-footer">Policy changes Focus rank and highlight. Click headers to sort whole rows; policy signals stay fixed. Click a row to highlight.</p>
  </Panel>;
}
function PolicyCells({ row, policy, selected }: { row: VillagesRow; policy: Page5State['policy']; selected: boolean }) {
  return <><td className={selected ? 'selected-policy' : ''}>{focusRank(row, policy)}</td><td className={selected ? 'selected-policy' : ''}>{policy === 'baseline_risk' ? decimal(row.baseline_risk, 2) : decimal(row[`${policy}_predicted_benefit`], 3)}</td></>;
}
export default function Robustness({ navigation }: { navigation: ReturnType<typeof usePageNavigation> }) {
  const state = navigation.getState('/robustness');
  const [data, setData] = useState<Page5Inputs>(), [error, setError] = useState(false);
  const [activeDetail, setActiveDetail] = useState<string | null>(null);
  useEffect(() => setActiveDetail(null), [state]);
  useEffect(() => {
    let active = true;
    loadDatasets(['overview', 'villages', 'anchors', 'overlap', 'robustness', 'coverage']).then(inputs => {
      validatePage5(inputs); if (active) setData(inputs);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const view = useMemo(() => data ? page5View(data, state) : null, [data, state]);
  const change = (patch: Partial<Page5State>) => navigation.change('/robustness', patch);
  const r = view?.robustness;
  return <DetailContext.Provider value={{ active: activeDetail, setActive: setActiveDetail }}><div className="p5">
    <PageHeader title="Robustness and Village Prioritization" subtitle="Separate village rankings, policy agreement and sensitivity — no declared winner." heading={navigation.heading}>
      <div className="p5-controls"><fieldset><legend>Focused policy</legend>{policies.map(policy => <button type="button" key={policy} disabled={!view} aria-pressed={state.policy === policy} onClick={() => change({ policy })}><span className={`policy-name-${policy}`}>{POLICY[policy].label}</span></button>)}</fieldset>
        <fieldset><legend>Capacity anchor (villages)</legend>{anchors.map(k => <button type="button" key={k} disabled={!view} aria-label={`${k} villages`} aria-pressed={state.k === k} onClick={() => change({ k })}>{k}</button>)}</fieldset></div>
    </PageHeader>
    {navigation.rejected.length > 0 && <Status kind="notice">Invalid state reset to defaults: {navigation.rejected.join(', ')}.</Status>}
    {error ? <Status kind="error">Unable to load frozen robustness evidence.</Status> : !data ? <Status kind="loading">Loading frozen robustness evidence…</Status> : view && <>
      <dl className="p5-kpis" aria-label="Frozen study findings">{frozenKPIs(data).map((value, i) => <KPIBlock key={i} label={['Trial villages', 'Lowest agreement (K=64)', 'Gain intervals including zero', 'Ranking-sensitive policies'][i]} value={value}
        support={['One candidate row per village', 'Simple HTE vs Baseline Risk · 38 shared', '3 policies × 4 prespecified anchors', 'At K=13, 32, 64 and 95'][i]} />)}</dl>
      <div className="p5-panels"><Rankings villages={data.villages.rows} state={state} change={change} />
        <div className="p5-right">
          <Panel title={`Policy Overlap at K=${state.k}`} className="p5-overlap"><p className="p5-caption">Jaccard agreement · common 0–1 scale</p>
            <TableViewport label="Policy set agreement"><table className="p5-grid"><colgroup><col style={{ width: '36%' }} /><col style={{ width: '35%' }} /><col style={{ width: '17%' }} /><col style={{ width: '12%' }} /></colgroup>
              <thead><tr><th scope="col">Policy pair</th><th scope="col">Agreement bar<span className="p5-reference-caption">50% reference</span></th><th scope="col">Agreement</th><th scope="col">Shared</th></tr></thead>
              <tbody>{view.overlap.map(row => <tr key={row.comparison}><th scope="row"><PolicyName policy={row.policy_left} /> <span className="p5-versus">vs</span> <PolicyName policy={row.policy_right} /></th>
                <td><ReadDetail label={`${POLICY[row.policy_left].label} vs ${POLICY[row.policy_right].label}: agreement ${percent(row.jaccard_overlap)}; ${row.shared_villages} shared villages.`} detail={<><strong>Policy set agreement · K={state.k}</strong><p>{POLICY[row.policy_left].label} vs {POLICY[row.policy_right].label}</p><p>{percent(row.jaccard_overlap)} · {row.shared_villages} shared villages</p></>}>
                  <div className="p5-bar"><span className="p5-bar-fill" style={{ width: `${row.jaccard_overlap * 100}%` }} /><i className="p5-bar-reference" style={{ left: '50%' }} /></div>
                </ReadDetail></td><td>{percent(row.jaccard_overlap)}</td><td>{row.shared_villages}</td></tr>)}</tbody>
            </table></TableViewport><p className="p5-footer">Set agreement, not causal performance.</p>
          </Panel>
          <Panel title="Robustness at Selected Capacity" className="p5-robustness"><p className="p5-context"><span className={`policy-name-${state.policy}`}>{POLICY[state.policy].label}</span> · K={state.k}</p>
            {!r ? <p className="p5-reconciliation">Not applicable — full-capacity reconciliation</p> : <>
              <div className="p5-summary"><span className="p5-estimate">{pp(r.phase11a_point_gain_vs_random, 4, true)}</span><span className="p5-classification">No clear capacity-specific advantage</span></div>
              <p className="p5-ci">Pointwise 95% CI: {ci(r.phase11a_gain_ci_lower, r.phase11a_gain_ci_upper, 4)} pp · includes zero</p>
              <div className="p5-interval-block"><h3>Gain vs random (pp)</h3><ReadDetail label={`${POLICY[state.policy].label} K=${state.k}: gain ${pp(r.phase11a_point_gain_vs_random, 4, true)}; pointwise 95% CI ${ci(r.phase11a_gain_ci_lower, r.phase11a_gain_ci_upper, 4)} pp.`}
                detail={<><strong>{POLICY[state.policy].label} · K={state.k}</strong><p>Gain: {pp(r.phase11a_point_gain_vs_random, 4, true)}</p><p>Pointwise 95% CI: {ci(r.phase11a_gain_ci_lower, r.phase11a_gain_ci_upper, 4)} pp</p></>}>
                <svg className="p5-interval" width="100%" height="50" role="img" aria-label="Gain interval on fixed −0.7 to +0.7 pp scale">
                  <line className="p5-zero" x1="50%" x2="50%" y1="5" y2="36" />
                  <line className="p5-ci-line" x1={`${gainPosition(r.phase11a_gain_ci_lower)}%`} x2={`${gainPosition(r.phase11a_gain_ci_upper)}%`} y1="21" y2="21" />
                  {[r.phase11a_gain_ci_lower, r.phase11a_gain_ci_upper].map(value => <line key={value} className="p5-ci-cap" x1={`${gainPosition(value)}%`} x2={`${gainPosition(value)}%`} y1="15" y2="27" />)}
                  <circle className="p5-estimate-marker" cx={`${gainPosition(r.phase11a_point_gain_vs_random)}%`} cy="21" r="5.5" fill={POLICY[state.policy].color} />
                  <text x="0" y="44">−0.7</text><text x="50%" y="44" textAnchor="middle">0</text><text x="100%" y="44" textAnchor="end">+0.7</text>
                </svg>
              </ReadDetail></div>
              <table className="p5-grid p5-findings"><colgroup><col style={{ width: '31%' }} /><col style={{ width: '23%' }} /><col style={{ width: '46%' }} /></colgroup><thead><tr>{['Check', 'Finding', 'Meaning'].map(text => <th key={text} scope="col">{text}</th>)}</tr></thead>
                <tbody>{sensitivityFindings(r).map(([check, finding, meaning]) => <tr key={check}><th scope="row">{check}</th><td>{finding}</td><td>{meaning}</td></tr>)}</tbody>
              </table><p className="p5-footer">Sensitivity checks do not establish an advantage.</p>
            </>}
          </Panel>
          <Panel title={`Descriptive Coverage by ${state.dimension === 'income' ? 'Income' : dimensions[state.dimension]}`} className="p5-coverage">
            <div className="p5-dimension"><SelectControl label="Coverage dimension" value={state.dimension} options={Object.entries(dimensions).map(([value, label]) => ({ value: value as Page5State['dimension'], label }))} onChange={dimension => change({ dimension })} /></div>
            <p className="p5-covered">Covered: {count(view.anchor.n_selected_randomized)} / 4,533</p>
            <TableViewport label="Descriptive coverage groups"><table className="p5-grid"><colgroup><col style={{ width: '26%' }} /><col style={{ width: '27%' }} /><col style={{ width: '13%' }} /><col style={{ width: '23%' }} /><col style={{ width: '11%' }} /></colgroup>
              <thead><tr><th scope="col">Group</th><th scope="col">Coverage bar<div className="p5-overall-header" style={{ '--overall': `${view.anchor.randomized_coverage * 100}%` } as CSSProperties}>
                <span className={`p5-overall-label${view.anchor.randomized_coverage > .65 ? ' p5-reference-left' : ''}`}>Overall {percent(view.anchor.randomized_coverage)}</span></div></th><th scope="col">Coverage</th><th scope="col">Covered / total</th><th scope="col">Gap</th></tr></thead>
              <tbody>{view.coverage.map(row => <tr key={row.category}><th scope="row">{coverageLabel(row.category)}</th><td>
                <ReadDetail label={`${coverageLabel(row.category)}: ${percent(row.subgroup_coverage)}; ${count(row.n_subgroup_covered)} of ${count(row.n_subgroup_total)} covered; gap ${pp(row.coverage_gap * 100, 1, true)}.`}
                  detail={<><strong>{coverageLabel(row.category)}</strong><p>{percent(row.subgroup_coverage)} · {count(row.n_subgroup_covered)} / {count(row.n_subgroup_total)}</p><p>Gap: {pp(row.coverage_gap * 100, 1, true)}</p></>}>
                  <div className="p5-bar"><span className="p5-bar-fill" data-value={row.subgroup_coverage} style={{ width: `${row.subgroup_coverage * 100}%` }} /><i className="p5-bar-reference" style={{ left: `${view.anchor.randomized_coverage * 100}%` }} /></div>
                </ReadDetail></td><td className="p5-coverage-percent">{percent(row.subgroup_coverage)}</td><td>{count(row.n_subgroup_covered)} / {count(row.n_subgroup_total)}</td><td>{pp(row.coverage_gap * 100, 1, true)}</td></tr>)}</tbody>
            </table></TableViewport><p className="p5-footer">Descriptive coverage; not a fairness target.</p>
          </Panel>
        </div>
      </div>
    </>}
  </div></DetailContext.Provider>;
}
