import { useMemo, useState } from 'react';
import type { Page5State } from '../contract';
import type { SpikeData } from './state';
import { colors, labels, policies, symbols } from '../metadata';
import { count, decimal, ci } from '../format';
import { TableViewport } from '../components/DataTable';
import EChart from '../components/charts/EChart';
import { chartFields, chartOption } from '../components/charts/rollout';
export default function Charts({ data, state }: { data: SpikeData; state: Page5State }) {
  const options = useMemo(() => ({ value: chartOption(data.rollout.rows, state, 'value'), gain: chartOption(data.rollout.rows, state, 'gain') }), [data, state.policy, state.k]);
  const [inspectK, setInspectK] = useState(state.k as number);
  const points = policies.map(policy => data.rollout.rows.find(r => r.policy === policy && r.capacity_villages === inspectK)!);
  return <>
    <p className="spike-legend">{policies.map(policy => <span key={policy}><span style={{ color: colors[policy] }}>{symbols[policy]}</span> {labels[policy]}</span>)}<span>◇ Random expectation / zero reference</span><span>Shaded band: selected-policy pointwise 95% CI</span></p>
    <div className="spike-charts">{(['value', 'gain'] as const).map(kind => <section key={kind}>
      <h2>{kind === 'value' ? 'Population rollout value (pp)' : 'Gain vs random (pp)'}</h2>
      <EChart option={options[kind]} chartId={kind} inspection={{ seriesIndex: 1, dataIndex: inspectK }} title={kind === 'value' ? 'Population rollout value' : 'Gain versus random'}
        description={`Percentage points. Three policies, fixed capacity domain 0 to 127; ${labels[state.policy]} pointwise 95% confidence band. Selected K=${state.k}. Use the capacity inspection control and table below for all values.`} />
    </section>)}</div>
    <section className="inspection">
      <label>Inspect chart capacity <input aria-label="Inspect chart capacity" type="range" min="0" max="127" step="1" value={inspectK} onChange={event => setInspectK(Number(event.target.value))} /></label>
      <p id="inspection-status" role="status">Chart detail: K={inspectK}. Selected policy: {labels[state.policy]}; selected capacity: {state.k}.</p>
      <TableViewport label="Chart values"><table aria-describedby="inspection-status"><caption>Keyboard-accessible chart values; inspecting does not change selected capacity</caption>
        <thead><tr><th scope="col">Policy</th><th scope="col">Covered</th><th scope="col">Value (pp)</th><th scope="col">Pointwise 95% CI (pp)</th><th scope="col">Gain (pp)</th><th scope="col">Pointwise 95% CI (pp)</th></tr></thead>
        <tbody>{points.map(row => <tr key={row.policy}><th scope="row">{labels[row.policy]}</th><td>{count(row.n_selected_randomized)}</td>
          {(['value', 'gain'] as const).map(kind => { const [value, low, high] = chartFields(kind); return <FragmentCells key={kind} value={row[value]} low={row[low]} high={row[high]} />; })}</tr>)}
          <tr><th scope="row">Random expectation</th><td>—</td><td>{decimal(points[0].point_random_expected_value, 4)}</td><td>—</td><td>0.0000</td><td>—</td></tr></tbody>
      </table></TableViewport>
    </section>
    <p>All 12 prespecified non-full gain intervals include zero. K=127 reconciles full rollout; no robust policy winner established.</p>
  </>;
}
function FragmentCells({ value, low, high }: { value: number; low: number; high: number }) {
  return <><td>{decimal(value, 4)}</td><td>{ci(low, high, 4)}</td></>;
}
