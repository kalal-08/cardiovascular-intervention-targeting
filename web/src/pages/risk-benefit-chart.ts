import type { EChartsOption } from 'echarts';
import type { VillagesRow, ValidationRow } from '../data.generated.ts';
import type { Page2State } from '../contract.ts';
import { POLICY } from '../metadata.ts';
import { riskPercent, pp } from '../format.ts';

type Signal = Page2State['signal'];
const pairs = [
  { comparison: 'mean_benefit_grf_oov_vs_mean_benefit_simple_oov', left: 'grf', right: 'simple' },
  { comparison: 'mean_benefit_grf_oov_vs_mean_risk0', left: 'grf', right: 'baseline_risk' },
  { comparison: 'mean_benefit_simple_oov_vs_mean_risk0', left: 'simple', right: 'baseline_risk' },
] as const;

export function pointDetail(row: VillagesRow, signal: Signal) {
  return `Village ${row.village_id}\nBaseline predicted risk: ${riskPercent(row.baseline_risk)}\n${POLICY[signal].label} benefit: ${pp(row[`${signal}_predicted_benefit`])}`;
}
export function riskBenefitView(rows: readonly VillagesRow[], validation: readonly ValidationRow[], signal: Signal) {
  const range = (field: 'baseline_risk' | 'grf_predicted_benefit' | 'simple_predicted_benefit') => {
    const values = rows.map(row => row[field]);
    const lo = Math.min(...values), hi = Math.max(...values);
    return field === 'baseline_risk' ? `${riskPercent(lo)}–${riskPercent(hi)}` : `${pp(lo).replace(' pp', '')}–${pp(hi)}`;
  };
  return {
    rows,
    points: rows.map(row => ({ name: row.village_id, value: [row.baseline_risk, row[`${signal}_predicted_benefit`]] })),
    ranges: [range('baseline_risk'), range('grf_predicted_benefit'), range('simple_predicted_benefit')],
    correlations: pairs.map(pair => {
      const matches = validation.filter(row => row.metric === 'village_signal_spearman' && row.normalization === 'village_aggregate' && row.model_or_comparison === pair.comparison);
      if (matches.length !== 1 || matches[0].estimate === null || !Number.isFinite(matches[0].estimate)) throw new Error('Frozen village correlation unavailable.');
      return { ...pair, value: matches[0].estimate };
    }),
  };
}
export function riskBenefitChart(view: ReturnType<typeof riskBenefitView>, signal: Signal): EChartsOption {
  const xName = 'Village mean baseline predicted 10-year ASCVD risk (%)';
  const yName = `${POLICY[signal].label}-predicted intervention benefit (percentage points)`;
  const desktop = {
    grid: { left: 84, right: 24 },
    xAxis: { name: xName, nameTextStyle: { fontSize: 14 }, axisLabel: { fontSize: 16, hideOverlap: false } },
    yAxis: { name: yName, nameGap: 58, nameTextStyle: { fontSize: 14 }, axisLabel: { fontSize: 16 } },
    series: [{ symbolSize: 13 }],
  };
  return {
    animation: true, animationDuration: 0, animationDurationUpdate: 180, animationEasingUpdate: 'cubicOut',
    // ECharts 6 auto bounds otherwise shrink the plot for the longer Simple HTE axis name.
    grid: { left: 84, right: 24, top: 20, bottom: 70, outerBoundsMode: 'none' },
    xAxis: { type: 'value', min: 12, max: 24, interval: 2,
      name: xName, nameLocation: 'middle', nameGap: 42,
      nameTextStyle: { color: '#081B4B', fontSize: 14 },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#53627C', fontSize: 16, formatter: value => `${value}%` },
      splitLine: { lineStyle: { color: '#DCE4EE', type: 'dashed', opacity: .85 } } },
    yAxis: { type: 'value', min: 1, max: 3.5, interval: .5,
      name: yName, nameLocation: 'middle', nameGap: 58,
      nameTextStyle: { color: '#081B4B', fontSize: 14 },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#53627C', fontSize: 16, formatter: value => value.toFixed(1) },
      splitLine: { lineStyle: { color: '#DCE4EE', type: 'dashed', opacity: .85 } } },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, enterable: true, padding: 12, borderWidth: 1,
      textStyle: { color: '#081B4B', fontSize: 14 }, backgroundColor: '#F8FAFC', borderColor: '#DCE4EE',
      formatter: params => { const point = Array.isArray(params) ? params[0] : params; return pointDetail(view.rows[point.dataIndex], signal); } },
    series: [{ id: 'risk-benefit-signal', type: 'scatter', name: POLICY[signal].label, symbol: 'circle', symbolSize: 13,
      itemStyle: { color: POLICY[signal].color, opacity: 1 }, data: view.points,
      emphasis: { scale: 1.3, itemStyle: { borderWidth: 0 } } }],
    // ECharts retains the last matching media patch unless a default restores its fields.
    media: [{ option: desktop }, { query: { maxHeight: 420 }, option: {
      ...desktop, yAxis: { ...desktop.yAxis, name: yName.replace(' (', '\n('), nameGap: 44 },
    } }, { query: { maxWidth: 550 }, option: {
      grid: { left: 64, right: 18 },
      xAxis: { name: 'Baseline predicted risk (%)', nameTextStyle: { fontSize: 13 }, axisLabel: { fontSize: 13, hideOverlap: true } },
      yAxis: { name: `${POLICY[signal].label} benefit (pp)`, nameGap: 46, nameTextStyle: { fontSize: 13 }, axisLabel: { fontSize: 13 } },
      series: [{ symbolSize: 9 }],
    } }],
  };
}
