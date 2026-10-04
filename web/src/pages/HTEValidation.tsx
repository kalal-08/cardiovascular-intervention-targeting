import { useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode, Ref, SyntheticEvent } from 'react';
import type { ValidationRow } from '../data.generated';
import { loadDatasets } from '../data/load';
import { count, decimal, ci, correlation } from '../format';
import { POLICY } from '../metadata';
import { PageHeader, Panel, Status } from '../components/layout';
import { AUTOC_DOMAIN, CALIBRATION_DOMAIN, SUBGROUP_DOMAIN, hteValidationView, intervalPosition } from './hte-validation-view';
import type { IntervalRow } from './hte-validation-view';
import './hte-validation.css';

type View = NonNullable<ReturnType<typeof hteValidationView>>;
const number = (value: number, digits = 3) => decimal(value, digits).replace('-', '−');
const bounds = (lower: number, upper: number, digits = 3) => ci(lower, upper, digits).replaceAll('-', '−');
const method = (row: ValidationRow) => row.model_or_comparison as keyof typeof POLICY;
const methodName = (row: ValidationRow) => method(row) === 'random' ? 'Random' : POLICY[method(row)].label;
const BOUNDARIES = [
  'AUTOC supports prioritization, not effect magnitude or policy value.',
  'Calibration near 1 does not establish superiority.',
  'Subgroup estimates are descriptive; CI overlap is not an interaction test.',
  'Baseline-risk groups are partially reconstructable.',
  'Endpoint: predicted risk, not observed cardiovascular events.',
  'Participant-score agreement is descriptive and does not validate individual treatment selection.',
  'Classical subgroup estimates are descriptive full-data results, not out-of-village prioritization validation.',
];
const PAIRS = [['grf', 'simple'], ['grf', 'baseline_risk'], ['simple', 'baseline_risk']] as const;

function Interval({ estimate, lower, upper, domain, reference, color = '#081B4B', filled = true, label, valueLabel, compact = false }: {
  estimate: number; lower: number; upper: number; domain: readonly [number, number]; reference: number;
  color?: string; filled?: boolean; label: string; valueLabel?: string; compact?: boolean;
}) {
  const position = (n: number) => `${intervalPosition(n, domain)}%`;
  const y = valueLabel ? 32 : compact ? 11 : 14;
  return <svg className="hte-interval" width="100%" height={valueLabel ? 56 : compact ? 22 : 28} role="img" aria-label={label}>
    <line className="interval-reference" x1={position(reference)} x2={position(reference)} y1="0" y2="100%" />
    <line className="interval-line" x1={position(lower)} x2={position(upper)} y1={y} y2={y} stroke={color} strokeWidth="2" />
    <circle cx={position(estimate)} cy={y} r={valueLabel ? 6 : 5} fill={filled ? color : '#FFFFFF'} stroke={color} strokeWidth="1.8" />
    {valueLabel && <text x={position(estimate)} dx="-8" y="14" textAnchor="end">{valueLabel}</text>}
  </svg>;
}
function Axis({ domain, ticks }: { domain: readonly [number, number]; ticks: readonly number[] }) {
  return <svg className="hte-axis" width="100%" height="32" aria-hidden="true">
    <line x1="0" x2="100%" y1="3" y2="3" />
    {ticks.map((value, index) => <g key={value}>
      <line x1={`${intervalPosition(value, domain)}%`} x2={`${intervalPosition(value, domain)}%`} y1="0" y2="7" />
      <text x={`${intervalPosition(value, domain)}%`} y="26" textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}>{number(value, domain === SUBGROUP_DOMAIN ? 0 : 1)}</text>
    </g>)}
  </svg>;
}
function Legend({ forest = false, reference }: { forest?: boolean; reference: string }) {
  return <div className="hte-legend" aria-label="Chart legend">
    <span><i className="legend-point" />{forest ? 'Overall estimate' : 'Estimate'}</span>
    {forest && <span><i className="legend-point legend-open" />Subgroup estimate</span>}
    <span><i className="legend-ci" />95% CI</span><span><i className="legend-reference" />{reference}</span>
  </div>;
}
function intervalDetail(row: IntervalRow, calibration: boolean) {
  return `${methodName(row)}; ${calibration ? 'Calibration slope' : 'AUTOC'}: ${number(row.estimate, 4)}; 95% CI ${bounds(row.ci_lower, row.ci_upper, 4)}; ${row.unit}. ${calibration ? 'Ideal slope = 1.' : 'Reference at 0.'} 4,508 participants with observed primary outcome; 127 randomized villages.`;
}
function Detail({ title, rows, qualification }: { title: ReactNode; rows: readonly (readonly [string, string])[]; qualification?: string }) {
  return <span className="hte-detail" role="tooltip" aria-hidden="true"><span className="hte-detail-title">{title}</span><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{qualification && <span className="hte-detail-note">{qualification}</span>}</span>;
}
function positionDetail(target: HTMLElement) {
  const detail = target.querySelector<HTMLElement>('.hte-detail');
  if (!detail) return;
  const anchor = target.getBoundingClientRect();
  const box = detail.getBoundingClientRect();
  if (!box.width) return;
  const panel = target.closest('.panel')!.getBoundingClientRect();
  const graphic = target.querySelector('svg')?.getBoundingClientRect();
  const table = target.closest('table');
  const plot = table?.getBoundingClientRect() ?? anchor;
  let left = Math.max(panel.left + 12, anchor.right - box.width);
  let top = !graphic ? anchor.bottom : plot.top - box.height - 8 >= 8 ? plot.top - box.height - 8 : plot.bottom + 8;
  if (table?.classList.contains('hte-forest-table')) {
    // Only the measured gap after numeric text is free; the empty SVG margin contains no data marks.
    const textEnds = [...table.querySelectorAll('tbody tr > :not(:last-child)')].flatMap(cell => {
      const range = document.createRange(); range.selectNodeContents(cell);
      return [...range.getClientRects()].filter(r => r.width > 0).map(r => r.right);
    });
    const gapLeft = Math.max(panel.left + 12, ...textEnds) + 8;
    const gapRight = Math.min(innerWidth - 8, ...[...table.querySelectorAll('.interval-line')].map(line => line.getBoundingClientRect().left)) - 8;
    const body = table.querySelector('tbody')!.getBoundingClientRect();
    left = Math.min(gapLeft, gapRight - box.width);
    top = Math.max(body.top, Math.min(anchor.top + anchor.height / 2 - box.height / 2, body.bottom - box.height));
    if (left < Math.max(8, panel.left + 12)) {
      // Constrained views use the same row-relative fallback, never a jump to the panel heading.
      left = Math.max(panel.left + 12, anchor.right - box.width);
      top = anchor.top - box.height - 8 >= 8 ? anchor.top - box.height - 8 : anchor.bottom + 8;
    }
  }
  detail.style.left = `${Math.max(8, Math.min(left, panel.right - box.width - 12, innerWidth - box.width - 8))}px`;
  detail.style.top = `${Math.max(8, Math.min(top, innerHeight - box.height - 8))}px`;
}
function ValidationPanel({ rows, calibration = false, revealDetail }: { rows: IntervalRow[]; calibration?: boolean; revealDetail: (event: SyntheticEvent<HTMLElement>) => void }) {
  const domain = calibration ? CALIBRATION_DOMAIN : AUTOC_DOMAIN;
  return <Panel title={calibration ? 'Calibration slopes' : 'Prioritization validation (AUTOC)'} className={calibration ? 'hte-calibration' : 'hte-autoc'}>
    <Legend reference={calibration ? 'Ideal slope = 1' : 'Reference at 0'} />
    <p className="hte-subtitle">{calibration ? 'Fold-adjusted estimates with 95% confidence intervals' : 'Within-fold priorities; point estimates with 95% confidence intervals'}</p>
    <table className={`hte-validation-table ${calibration ? 'calibration-table' : 'autoc-table'}`} aria-label={calibration ? 'Calibration estimates and intervals' : 'AUTOC estimates and intervals'}>
      <colgroup><col className="method-column" />{!calibration && <col className="estimate-column" />}<col /></colgroup>
      <thead className="sr-only"><tr><th scope="col">Method</th>{!calibration && <th scope="col">Estimate</th>}<th scope="col">Estimate and 95% confidence interval</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.validation_id} tabIndex={0} aria-label={intervalDetail(row, calibration)} onMouseEnter={revealDetail} onFocus={revealDetail} onClick={revealDetail}>
        <th scope="row"><span className={`hte-method-${method(row)}`}><i className={`hte-method-symbol ${method(row) === 'baseline_risk' ? 'policy-symbol-baseline_risk' : ''}`} aria-hidden="true" />{methodName(row)}</span></th>
        {!calibration && <td className="hte-estimate">{number(row.estimate, 4)}</td>}
        <td className="hte-graphic-cell"><Interval estimate={row.estimate} lower={row.ci_lower} upper={row.ci_upper} domain={domain} reference={calibration ? 1 : 0}
          color={POLICY[method(row)].color} label={intervalDetail(row, calibration)} valueLabel={calibration ? number(row.estimate) : undefined} />
          <Detail title={<><span className={`hte-method-${method(row)}`}>{methodName(row)}</span> · {calibration ? 'Calibration slope' : 'AUTOC'}</>} rows={[["Estimate", number(row.estimate, 4)], ['95% CI', bounds(row.ci_lower, row.ci_upper, 4)], ['N', '4,508 · 127 villages']]} />
        </td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={calibration ? 1 : 2} /><td><Axis domain={domain} ticks={calibration ? [0, 0.5, 1, 1.5, 1.8] : [-0.5, 0, 0.5, 1, 1.5]} /></td></tr></tfoot>
    </table>
    <p className="hte-note">{calibration ? 'Both 95% confidence intervals include the ideal slope of 1.' : 'Positive values support prioritization above the overall participant population.'}</p>
  </Panel>;
}
export default function HTEValidation({ heading }: { heading: Ref<HTMLHeadingElement> }) {
  const [view, setView] = useState<View | null>();
  const [error, setError] = useState(false);
  const [detailsDismissed, setDetailsDismissed] = useState(false);
  useLayoutEffect(() => {
    if (!detailsDismissed) document.querySelectorAll<HTMLElement>('.hte-detail').forEach(detail => {
      if (detail.getBoundingClientRect().height) positionDetail(detail.closest<HTMLElement>('tr, .hte-evidence-status')!);
    });
  }, [detailsDismissed]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetailsDismissed(true); };
    const hide = () => setDetailsDismissed(true);
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.hte-detail')) return;
      document.querySelectorAll<HTMLElement>('.hte-detail').forEach(detail => {
        if (detail.getBoundingClientRect().height) positionDetail(detail.closest<HTMLElement>('tr, .hte-evidence-status')!);
      });
    };
    const outside = (event: MouseEvent) => { if (!(event.target as Element).closest('.hte-validation-table tbody tr, .hte-forest-table tbody tr, .hte-evidence-status.comparative')) hide(); };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('click', outside);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('click', outside); window.removeEventListener('resize', hide); window.removeEventListener('scroll', scroll, true); };
  }, []);
  useEffect(() => {
    let active = true;
    loadDatasets(['validation', 'subgroups']).then(data => {
      const result = hteValidationView(data.validation.rows, data.subgroups.rows);
      if (active) setView(result);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const revealDetail = (event: SyntheticEvent<HTMLElement>) => {
    const target = event.currentTarget;
    setDetailsDismissed(false);
    requestAnimationFrame(() => positionDetail(target));
  };
  return <div className={`hte-validation${detailsDismissed ? ' details-dismissed' : ''}`}>
    <PageHeader title="HTE Validation" subtitle="Evaluate prioritization performance, calibration, and classical subgroup evidence" heading={heading} />
    {error ? <Status kind="error">Unable to load frozen HTE evidence.</Status> : view === undefined ? <Status kind="loading">Loading frozen HTE evidence…</Status> : view === null ? <Status kind="empty">No frozen HTE evidence available.</Status> : <>
      <div className="hte-top">
        <ValidationPanel rows={view.autoc} revealDetail={revealDetail} />
        <ValidationPanel rows={view.calibration} calibration revealDetail={revealDetail} />
        <Panel title="Participant-score Ranking Agreement" className="hte-agreement">
          <p className="hte-subtitle">Pairwise Spearman ρ on raw participant scores · N = 4,533</p>
          <table aria-label="Participant-score ranking agreement" className="hte-agreement-table">
            <thead><tr><th scope="col">Comparison</th><th scope="col">ρ</th></tr></thead>
            <tbody>{view.agreement.map((row, index) => <tr key={row.validation_id}>
              <th scope="row"><span className="pair-symbols" aria-hidden="true">{PAIRS[index].map(policy => <i key={policy} className={`policy-symbol-${policy}`} />)}</span>{PAIRS[index].map((policy, i) => <span key={policy}>{i > 0 && ' vs '}<span className={`policy-name-${policy}`}>{POLICY[policy].label}</span></span>)}</th>
              <td>{correlation(row.estimate)}</td>
            </tr>)}</tbody>
          </table>
          <p className="hte-note">Spearman ρ ranges from −1 to 1; agreement does not establish superiority.</p>
          <span className="sr-only">Aggregate raw participant-score correlations for 4,533 randomized participants. No participant records are displayed.</span>
        </Panel>
      </div>
      <div className="hte-bottom">
        <Panel title="Adjusted classical subgroup effects" className="hte-forest">
          <Legend forest reference="No-effect reference" />
          <p className="hte-subtitle">Available-primary-outcome analysis; lower values favor intervention</p>
          <div className="hte-forest-scroll" tabIndex={0} role="region" aria-label="All 13 subgroup effects; scroll horizontally on narrow screens">
            <table aria-label="Adjusted classical subgroup effects" className="hte-forest-table">
              <colgroup><col className="moderator-column" /><col className="subgroup-column" /><col className="n-column" /><col className="effect-column" /><col /></colgroup>
              <thead><tr><th scope="col">Moderator</th><th scope="col">Subgroup</th><th scope="col">N</th><th scope="col">Adjusted effect (95% CI), pp</th><th scope="col">Lower favors intervention</th></tr></thead>
              <tbody>{view.subgroups.map((row, index) => {
                const first = index === 0 || row.moderator !== view.subgroups[index - 1].moderator;
                const qualification = row.reconstruction_status === 'PARTIALLY RECONSTRUCTABLE' ? 'Groups partially reconstructable' : 'Descriptive full-data estimate';
                const label = `${row.moderator_label}; ${row.subgroup.replace('>=', '≥')}; N ${count(row.analysis_n)} observed-outcome participants; adjusted effect ${number(row.treatment_effect)} pp; 95% CI ${bounds(row.ci_lower, row.ci_upper)} pp; ${qualification}. Lower favors intervention. Reference at 0.`;
                return <tr key={row.subgroup_effect_id} tabIndex={0} aria-label={label} onMouseEnter={revealDetail} onFocus={revealDetail} onClick={revealDetail} className={`${index === 0 ? 'overall-row' : ''} ${first && index > 0 ? 'moderator-start' : ''}`}>
                  <td>{first ? row.moderator === 'income' ? 'Income' : row.moderator === 'baseline_risk' ? 'Baseline risk*' : row.moderator_label : <span className="sr-only">{row.moderator_label}</span>}</td>
                  <th scope="row">{row.subgroup.replace('>=', '≥')}</th><td>{count(row.analysis_n)}</td>
                  <td>{number(row.treatment_effect)} ({bounds(row.ci_lower, row.ci_upper)})</td>
                  <td><Interval estimate={row.treatment_effect} lower={row.ci_lower} upper={row.ci_upper} domain={SUBGROUP_DOMAIN} reference={0} filled={index === 0} label={label} compact />
                    <Detail title={`${row.moderator_label} · ${row.subgroup.replace('>=', '≥')}`} rows={[["Effect", `${number(row.treatment_effect)} pp`], ['95% CI', `${bounds(row.ci_lower, row.ci_upper)} pp`], ['N', count(row.analysis_n)]]} qualification={row.reconstruction_status === 'PARTIALLY RECONSTRUCTABLE' ? qualification : undefined} /></td>
                </tr>;
              })}</tbody>
              <tfoot><tr><td colSpan={4} /><td><Axis domain={SUBGROUP_DOMAIN} ticks={[-4, -3, -2, -1, 0, 1]} /></td></tr></tfoot>
            </table>
          </div>
          <div className="hte-forest-footer"><p>Income: annual household income (yuan). *Baseline risk: baseline predicted 10-year ASCVD risk; groups partially reconstructable. Descriptive full-data estimates; CI overlap is not an interaction test.</p>
            <p>Adjusted difference in predicted 10-year ASCVD risk (percentage points)</p></div>
        </Panel>
        <Panel title="Evidence summary" className="hte-evidence">
          <div className="hte-evidence-status support"><span><span className="policy-name-grf">GRF</span> prioritization validation</span><strong>{view.support.classification}</strong></div>
          {view.comparisonSummary ? <div className="hte-evidence-status comparative" tabIndex={0} onMouseEnter={revealDetail} onFocus={revealDetail} onClick={revealDetail} aria-label={`Comparative evidence: ${view.comparisonSummary}. Incremental GRF value versus Simple HTE: ${view.comparisons[0].classification}. GRF versus Baseline Risk: ${view.comparisons[1].classification}.`}>
            <span>Comparative evidence</span><strong>{view.comparisonSummary}</strong>
            <Detail title="Superiority not demonstrated" rows={[["Comparisons", 'GRF vs Simple HTE; GRF vs Baseline Risk']]} />
          </div> : view.comparisons.map(row => <div key={row.validation_id} className="hte-evidence-status comparative"><span>{row.model_or_comparison === 'incremental_grf_vs_simple' ? 'Incremental GRF value versus Simple HTE' : 'GRF versus Baseline Risk'}</span><strong>{row.classification}</strong></div>)}
          <section className="hte-boundaries" aria-labelledby="hte-boundaries-title"><h2 id="hte-boundaries-title">Interpretation boundaries</h2>
            <ul>{BOUNDARIES.map(text => <li key={text}>{text}</li>)}</ul>
          </section>
        </Panel>
      </div>
    </>}
  </div>;
}
