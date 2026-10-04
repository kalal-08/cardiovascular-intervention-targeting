import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anchors, defaults, dimensions, focusRank, frozenKPIs, policies, readState, selectedPanels, sortFields, sortVillages, stateURL } from '../src/spikes/state.ts';
import type { SpikeData } from '../src/spikes/state.ts';
import type { SortField } from '../src/contract.ts';
import { chartDomain, chartFields, chartOption, tooltipText } from '../src/spikes/chart-option.ts';

const names = ['overview', 'villages', 'rollout', 'anchors', 'overlap', 'robustness', 'coverage'];
const data = Object.fromEntries(names.map(name => [name, JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))])) as SpikeData;
const snapshot = JSON.stringify(data);
assert.deepEqual(readState('page5', '').state, defaults);
assert.deepEqual(frozenKPIs(data), ['127', '42.2%', '12 of 12', '3']);
const first = { grf: ['66', '47', '55'], simple: ['33', '71', '47'], baseline_risk: ['106', '33', '47'] };
const last = { grf: '121', simple: '80', baseline_risk: '12' };
for (const policy of policies) {
  const state = { ...defaults, policy };
  const ranked = sortVillages(data.villages.rows, state);
  assert.deepEqual(ranked.slice(0, 3).map(r => r.village_id), first[policy]);
  assert.equal(ranked.at(-1)!.village_id, last[policy]);
  assert.deepEqual(ranked.map(r => focusRank(r, policy)), Array.from({ length: 127 }, (_, i) => i + 1));
  for (const k of anchors) for (const dimension of Object.keys(dimensions) as (keyof typeof dimensions)[]) {
    const selected = { ...state, k, dimension };
    const panels = selectedPanels(data, selected);
    assert.deepEqual(sortVillages(data.villages.rows, selected), ranked);
    assert.equal(panels.coverage[0].n_overall_covered, panels.anchor.n_selected_randomized);
    assert.equal(panels.overlap.length, 3);
    assert.deepEqual(readState('page5', new URL(stateURL('page5', selected), 'http://localhost').search).state, selected);
    assert.deepEqual(frozenKPIs(data), ['127', '42.2%', '12 of 12', '3']);
    const curve = data.rollout.rows.find(r => r.policy === policy && r.capacity_villages === k)!;
    assert.equal(curve.point_population_rollout_value, panels.anchor.point_population_rollout_value);
    if (k === 127) {
      assert.equal(panels.robustness, undefined);
      assert.equal(panels.anchor.point_gain_vs_random, 0);
      assert(panels.overlap.every(r => r.shared_villages === 127 && r.jaccard_overlap === 1));
      assert(panels.coverage.every(r => r.subgroup_coverage === 1 && r.coverage_gap === 0));
    }
  }
}
for (const sort of Object.keys(sortFields) as SortField[]) for (const direction of ['asc', 'desc'] as const) {
  const state = { ...defaults, sort, direction };
  const ordered = sortVillages(data.villages.rows, state);
  assert.equal(ordered.length, 127);
  assert(ordered.every(row => data.villages.rows.includes(row)), 'Whole rows remain intact');
  if (sort !== 'focus') for (const policy of policies) assert.deepEqual(sortVillages(ordered, { ...state, policy }), ordered);
}
const tied = sortVillages(sortVillages(data.villages.rows, { ...defaults, direction: 'desc' }), { ...defaults, sort: 'participants' });
for (let i = 1; i < tied.length; i++) if (tied[i - 1].n_randomized === tied[i].n_randomized) assert(tied[i - 1].simple_candidate_rank > tied[i].simple_candidate_rank);
assert.deepEqual(readState('page5', '?policy=wrong&k=64&k=13&dimension=bad&sort=bad&direction=bad').rejected, ['policy', 'k', 'dimension', 'sort', 'direction']);
assert.equal(stateURL('page5', readState('page5', '?unapproved=x').state), '/__spikes/page5');
assert.equal(stateURL('page4', { ...defaults, dimension: 'income', sort: 'participants' }), '/__spikes/page4');
assert.equal(JSON.stringify(data), snapshot, 'No source data mutation');
for (const kind of ['value', 'gain'] as const) for (const policy of policies) for (const k of anchors) {
  const state = { ...defaults, policy, k };
  const option = chartOption(data.rollout.rows, state, kind);
  const series = option.series as import('echarts').SeriesOption[];
  assert.equal(series.length, 5);
  const reference = series[4] as import('echarts').LineSeriesOption;
  if (kind === 'gain') assert((reference.data as number[][]).every(point => point[1] === 0));
  const [value, low, high] = chartFields(kind);
  const selected = data.rollout.rows.filter(row => row.policy === policy);
  const line = series[policies.indexOf(policy) + 1] as import('echarts').LineSeriesOption;
  assert.deepEqual((line.markPoint!.data!.find(point => point.name === 'Selected capacity') as { coord: number[] }).coord, [k, selected[k][value]]);
  // Exercise the CI render callback in data coordinates: no stacking of negative bounds.
  const band = series[0] as import('echarts').CustomSeriesOption;
  const rendered = band.renderItem!({} as never, { coord: (point: number[]) => point } as never) as { shape: { points: number[][] } };
  assert.deepEqual(rendered.shape.points, [...selected.map(row => [row.capacity_villages, row[low]]), ...[...selected].reverse().map(row => [row.capacity_villages, row[high]])]);
  const domain = chartDomain(data.rollout.rows, kind);
  assert(selected.every(row => row[low] >= domain[0] && row[high] <= domain[1]));
  const tooltip = tooltipText(data.rollout.rows, state, kind, k);
  assert(tooltip.includes(selected[k][value].toFixed(4)) && tooltip.includes(selected[k][low].toFixed(4)) && tooltip.includes('pp'));
  assert.equal(tooltip.includes('Random expectation'), kind === 'value');
}
console.log('PASS: 75 states, 18 sorts, stable ties, whole rows, manual persistence, fixed KPIs/signals, ranking checkpoints, panel scope, K127, URL validation/round trips.');
console.log('PASS: 30 chart states, exact CI polygons, selected markers, fixed domains, references and source-precision tooltips.');
