import type { EChartsOption, CustomSeriesOption } from 'echarts';
import type { OverviewRow } from '../data.generated.ts';
import { decimal, ci, effect } from '../format.ts';
import { colors } from '../metadata.ts';

export const EFFECT_DOMAIN = [-3, 1] as const;
export const effectLabel = (value: number) => decimal(value, 3).replace('-', '−');
export function effectSummary(row: OverviewRow) {
  return `Adjusted difference in predicted 10-year ASCVD risk: ${effect(row.treatment_effect_estimate)}; 95% CI ${ci(row.treatment_effect_ci_lower, row.treatment_effect_ci_upper)} pp. Lower predicted risk favors intervention. Dashed line: zero effect.`;
}
export function overviewChart(row: OverviewRow): EChartsOption {
  const lower = row.treatment_effect_ci_lower, estimate = row.treatment_effect_estimate, upper = row.treatment_effect_ci_upper;
  const interval: CustomSeriesOption = {
    type: 'custom', name: 'Adjusted effect and 95% CI', data: [[lower, estimate, upper]],
    renderItem: (_params, api) => {
      const lo = api.coord([lower, 0.6]), point = api.coord([estimate, 0.6]), hi = api.coord([upper, 0.6]);
      return { type: 'group', children: [
        { type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: { stroke: colors.simple, lineWidth: 3 } },
        ...[lo, hi].map(p => ({ type: 'line' as const, shape: { x1: p[0], y1: p[1] - 10, x2: p[0], y2: p[1] + 10 }, style: { stroke: colors.simple, lineWidth: 3 } })),
        { type: 'circle', shape: { cx: point[0], cy: point[1], r: 7 }, style: { fill: colors.simple } },
        // At narrow widths the visible CI summary carries both bounds; preserve one readable point label.
        ...(api.getWidth() < 520 ? [[point, estimate]] : [[lo, lower], [point, estimate], [hi, upper]]).map(([p, value]) => ({
          type: 'text' as const, style: { x: (p as number[])[0], y: (p as number[])[1] - 46,
            text: effectLabel(value as number), font: api.getWidth() < 420 ? 'bold 19px Segoe UI, sans-serif' : '26px Segoe UI, sans-serif', fill: '#081B4B', align: 'center' as const, verticalAlign: 'middle' as const },
        })),
      ] };
    },
    markLine: { silent: true, symbol: 'none', label: { show: false },
      lineStyle: { color: '#53627C', type: [5, 4], width: 1.2 }, data: [{ xAxis: 0 }] },
  };
  return {
    animation: false, textStyle: { color: '#081B4B', fontFamily: 'Segoe UI, sans-serif' },
    grid: { left: 16, right: 16, top: 48, bottom: 40 },
    xAxis: { type: 'value', min: EFFECT_DOMAIN[0], max: EFFECT_DOMAIN[1], interval: 1,
      axisLine: { onZero: false, lineStyle: { color: '#081B4B', width: 2 } },
      axisTick: { show: true, length: 5 }, axisLabel: { fontSize: 14, color: '#53627C', margin: 12 }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: 1, show: false },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, enterable: true, backgroundColor: '#F8FAFC', borderColor: '#DCE4EE', borderWidth: 1, padding: 12, textStyle: { color: '#081B4B', fontSize: 14 },
      formatter: () => `Predicted 10-year ASCVD risk\nEstimate: ${effect(estimate)}\n95% CI: ${ci(lower, upper)} pp\nLower predicted risk favors intervention.` },
    series: [interval],
  };
}
