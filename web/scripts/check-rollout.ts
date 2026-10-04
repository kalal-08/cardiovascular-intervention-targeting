import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import type { RolloutRow, AnchorsRow, OverviewRow } from '../src/data.generated.ts';
assert(existsSync(new URL('../src/pages/rollout-view.ts', import.meta.url)), 'Production Page-4 mapping is not implemented');
const { rolloutView, rolloutChart, rolloutTooltip } = await import('../src/pages/rollout-view.ts');
const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8')).rows;
const rows: RolloutRow[] = read('rollout'), anchors: AnchorsRow[] = read('anchors'), overview: OverviewRow[] = read('overview');
const before = JSON.stringify([rows, anchors, overview]);
const values = { grf: ['0.1751', '0.5317', '0.9153', '1.3236', '1.8641'], simple: ['0.1296', '0.6507', '1.0784', '1.6214', '1.8641'], baseline_risk: ['0.3104', '0.5980', '1.0241', '1.2328', '1.8641'] };
for (const policy of ['grf', 'simple', 'baseline_risk'] as const) for (const [i, k] of [13, 32, 64, 95, 127].entries()) {
  const state = { policy, k: k as 13 | 32 | 64 | 95 | 127 };
  const view = rolloutView(rows, anchors, overview, state);
  assert.equal(view.selected.point_population_rollout_value.toFixed(4), values[policy][i]);
  assert.deepEqual(view.selected, anchors.find(r => r.policy === policy && r.capacity_villages === k));
  assert.equal(view.matrix.length, 4); assert(view.matrix.every(r => r.values.length === 5));
  assert.deepEqual(view.matrix.slice(0, 3).map(r => r.values.map(v => v.toFixed(4))), Object.values(values));
  assert.deepEqual(view.matrix[3].values.map(v => v.toFixed(4)), ['0.1908', '0.4697', '0.9394', '1.3944', '1.8641']);
  assert.equal(view.randomizedTotal, 4533); assert.equal(view.evaluationTotal, 4508); assert.equal(view.villagesTotal, 127);
  if (k === 127) {
    assert.equal(view.selected.point_gain_vs_random, 0); assert.equal(view.selected.gain_ci_lower, 0); assert.equal(view.selected.gain_ci_upper, 0);
    assert.equal(view.selected.n_selected_randomized, 4533); assert(view.selected.population_value_ci_upper > view.selected.population_value_ci_lower);
  } else assert(view.selected.gain_ci_lower <= 0 && view.selected.gain_ci_upper >= 0);
  for (const kind of ['value', 'gain'] as const) {
    const option = rolloutChart(rows, state, kind) as any;
    assert.deepEqual([option.xAxis.min, option.xAxis.max], [0, 127]);
    assert.deepEqual([option.yAxis.min, option.yAxis.max], kind === 'value' ? [-.2, 2.8] : [-.6, .8]);
    assert.equal(option.series.length, 5);
    assert.deepEqual(option.xAxis.axisLabel.customValues, [0, 13, 32, 64, 95, 127], 'Frozen capacity anchors must be visible on the numeric axis');
    assert.deepEqual(option.xAxis.axisTick.customValues, [0, 13, 32, 64, 95, 127]);
    assert.equal(option.xAxis.splitLine.show, true, 'Capacity gridlines must remain visible');
    const fields = kind === 'value' ? ['point_population_rollout_value', 'population_value_ci_lower', 'population_value_ci_upper'] as const : ['point_gain_vs_random', 'gain_ci_lower', 'gain_ci_upper'] as const;
    for (const [j, p] of ['grf', 'simple', 'baseline_risk'].entries()) {
      const expected = rows.filter(r => r.policy === p);
      assert.equal(option.series[j + 1].data.length, 128);
      assert.deepEqual(option.series[j + 1].data, expected.map(r => [r.capacity_villages, r[fields[0]]]));
      for (const point of option.series[j + 1].markPoint.data) {
        assert.equal(point.itemStyle.color, p === policy && point.coord[0] === k ? '#fff' : { grf: '#0B2E83', simple: '#0798A5', baseline_risk: '#F28C00' }[p], 'Only the selected policy/capacity marker is hollow');
      }
    }
    assert.equal(option.series[4].markPoint?.symbol, kind === 'value' ? 'diamond' : undefined, 'Random anchor diamonds belong only on the value chart');
    assert.equal(option.series[1].markLine.label.rotate, 0, 'Selected-capacity label stays horizontal as in the reference');
    const rendered = option.series[0].renderItem({}, { coord: (point: number[]) => point });
    const selected = rows.filter(r => r.policy === policy);
    assert.deepEqual(rendered.shape.points, [...selected.map(r => [r.capacity_villages, r[fields[1]]]), ...[...selected].reverse().map(r => [r.capacity_villages, r[fields[2]]])]);
    for (const inspect of [0, 13, 64, 126, 127]) {
      const tooltip = rolloutTooltip(rows, state, kind, inspect);
      for (const p of ['grf', 'simple', 'baseline_risk']) {
        const r = rows.find(r => r.policy === p && r.capacity_villages === inspect)!;
        assert(tooltip.includes(r[fields[0]].toFixed(4))); assert(tooltip.includes(r[fields[1]].toFixed(4))); assert(tooltip.includes(r[fields[2]].toFixed(4)));
        assert(tooltip.includes(r.n_selected_randomized.toLocaleString('en-US')));
      }
      assert.equal(tooltip.includes('Random expectation'), kind === 'value');
      assert(tooltip.includes(`K=${inspect}`) && tooltip.includes(`K=${k}`));
    }
  }
}
assert.equal(rolloutView(rows, anchors, overview, { policy: 'simple', k: 64 }).selected.n_selected_randomized, 2299);
assert.throws(() => rolloutView(rows.slice(1), anchors, overview, { policy: 'simple', k: 64 }), /records/);
assert.throws(() => rolloutView(rows, anchors.slice(1), overview, { policy: 'simple', k: 64 }), /records/);
assert.throws(() => rolloutView(rows, anchors, [], { policy: 'simple', k: 64 }), /records/);
assert.equal(JSON.stringify([rows, anchors, overview]), before);
console.log('PASS: production Page-4 15 states, fixed matrix/counts, complete curves/CI geometry, fixed domains, comparison tooltips, full-capacity uncertainty and source immutability.');
