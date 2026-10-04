import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { init } from 'echarts';
import { riskBenefitView, riskBenefitChart, pointDetail } from '../src/pages/risk-benefit-chart.ts';
import type { VillagesRow, ValidationRow } from '../src/data.generated.ts';
const villages: VillagesRow[] = JSON.parse(readFileSync(new URL('../public/data/villages.json', import.meta.url), 'utf8')).rows;
const validation: ValidationRow[] = JSON.parse(readFileSync(new URL('../public/data/validation.json', import.meta.url), 'utf8')).rows;
const before = JSON.stringify(villages);
for (const signal of ['grf', 'simple'] as const) {
  const view = riskBenefitView(villages, validation, signal);
  assert.equal(view.points.length, 127);
  assert.equal(new Set(view.points.map(point => point.name)).size, 127);
  for (const [index, row] of villages.entries()) {
    assert.equal(view.points[index].name, row.village_id);
    assert.deepEqual(view.points[index].value, [row.baseline_risk, signal === 'grf' ? row.grf_predicted_benefit : row.simple_predicted_benefit]);
    assert.equal(pointDetail(row, signal), `Village ${row.village_id}\nBaseline predicted risk: ${row.baseline_risk.toFixed(2)}%\n${signal === 'grf' ? 'GRF' : 'Simple HTE'} benefit: ${(signal === 'grf' ? row.grf_predicted_benefit : row.simple_predicted_benefit).toFixed(3)} pp`);
  }
  assert.deepEqual(view.ranges, ['13.07%–23.31%', '1.399–2.823 pp', '1.147–3.277 pp']);
  assert.deepEqual(view.correlations.map(item => item.value), [0.4649243063367078, 0.4305047806524184, 0.3349034495688038]);
  const option = riskBenefitChart(view, signal) as any;
  assert.equal(option.xAxis.min, 12); assert.equal(option.xAxis.max, 24);
  assert.equal(option.yAxis.min, 1); assert.equal(option.yAxis.max, 3.5);
  assert.equal(option.series.length, 1);
  assert.equal(option.series[0].type, 'scatter');
  assert.equal(option.series[0].symbol, 'circle');
  assert.equal(option.series[0].itemStyle.color, signal === 'grf' ? '#0B2E83' : '#0798A5');
  assert.equal(option.series[0].data.length, 127);
  assert.equal(option.animation, true);
  assert.equal(option.animationDuration, 0);
  assert.equal(option.animationDurationUpdate, 180);
  assert.equal(option.animationEasingUpdate, 'cubicOut');
  assert.equal(option.series[0].id, 'risk-benefit-signal');
  const text = option.tooltip.formatter({ dataIndex: 0 });
  assert.equal(text, pointDetail(villages[0], signal));
  assert(!text.includes(signal === 'grf' ? 'Simple HTE benefit' : 'GRF benefit'));
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 1000, height: 302 });
  const label = signal === 'grf' ? 'GRF' : 'Simple HTE';
  const compactName = `${label}-predicted benefit\n(percentage points)`;
  try {
    chart.setOption({ ...option, animation: false });
    assert.equal((chart.getOption().yAxis as any[])[0].name, compactName, 'Short desktop chart uses a complete, compact benefit/unit label');
    assert(chart.renderToSVGString().includes(`${label}-predicted benefit`), 'Compact label is rendered, not only configured');
    chart.resize({ width: 1000, height: 340 });
    assert.equal((chart.getOption().yAxis as any[])[0].name, compactName);
    chart.resize({ width: 1000, height: 360 });
    assert.equal((chart.getOption().yAxis as any[])[0].name, `${label}-predicted intervention benefit\n(percentage points)`, 'Monitor restores its existing label');
    chart.resize({ width: 1000, height: 440 });
    assert.equal((chart.getOption().yAxis as any[])[0].name, `${label}-predicted intervention benefit (percentage points)`, 'Tall chart restores its full label');
    chart.resize({ width: 360, height: 302 });
    assert.equal((chart.getOption().yAxis as any[])[0].name, `${label} benefit (pp)`, 'Existing narrow-chart label remains unchanged');
    chart.resize({ width: 1000, height: 302 });
    assert.equal((chart.getOption().yAxis as any[])[0].name, compactName, 'Returning to compact desktop restores the correct label');
    assert.equal((chart.getOption().yAxis as any[])[0].min, 1);
    assert.equal((chart.getOption().yAxis as any[])[0].max, 3.5);
  } finally { chart.dispose(); }
}
assert.equal(JSON.stringify(villages), before);
const changed = villages.map((row, index) => index === 0 ? { ...row, baseline_risk: 24, grf_predicted_benefit: 3.4 } : row);
assert.deepEqual(riskBenefitView(changed, validation, 'grf').points[0].value, [24, 3.4]);
assert.equal(riskBenefitView(changed, validation, 'grf').ranges[0], '13.07%–24.00%');
assert.equal(riskBenefitView(villages, [...validation].reverse(), 'grf').correlations[0].value, 0.4649243063367078);
assert.throws(() => riskBenefitView(villages, [], 'grf'), /correlation/);
assert.throws(() => riskBenefitView(villages, validation.map(row => row.metric === 'village_signal_spearman' ? { ...row, estimate: null } : row), 'grf'), /correlation/);
console.log('PASS: both Page-2 signals preserve 127 source-keyed coordinates, ranges, fixed axes, upstream correlations, selected-only detail, units and source immutability.');
