import type { EChartsOption, LineSeriesOption, CustomSeriesOption } from 'echarts';
import type { Page4State } from '../../contract.ts';
import type { RolloutRow } from '../../data.generated.ts';
import { anchors, colors, labels, policies, POLICY } from '../../metadata.ts';
import { count, decimal, ci } from '../../format.ts';

export type ChartKind = 'value' | 'gain';
export function chartFields(kind: ChartKind) {
  return kind === 'value'
    ? ['point_population_rollout_value', 'population_value_ci_lower', 'population_value_ci_upper'] as const
    : ['point_gain_vs_random', 'gain_ci_lower', 'gain_ci_upper'] as const;
}
export function chartDomain(rows: readonly RolloutRow[], kind: ChartKind) {
  const [, low, high] = chartFields(kind);
  return [Math.floor(Math.min(0, ...rows.map(r => r[low])) * 5) / 5,
    Math.ceil(Math.max(...rows.map(r => r[high])) * 5) / 5];
}
export function tooltipText(rows: readonly RolloutRow[], state: Page4State, kind: ChartKind, k: number) {
  const [value, low, high] = chartFields(kind);
  const selected = policies.map(policy => rows.find(r => r.policy === policy && r.capacity_villages === k)!);
  return [`Capacity K=${k}\nSelected: ${labels[state.policy]} · K=${state.k}`,
    ...selected.map(r => `${labels[r.policy]} · ${count(r.n_selected_randomized)} covered\n${decimal(r[value], 4)} pp\n95% CI ${ci(r[low], r[high], 4)} pp`),
    ...(kind === 'value' ? [`Random expectation · ${decimal(selected[0].point_random_expected_value, 4)} pp`] : [])].join('\n');
}
export function chartOption(rows: readonly RolloutRow[], state: Page4State, kind: ChartKind): EChartsOption {
  const [value, low, high] = chartFields(kind);
  const selected = rows.filter(r => r.policy === state.policy);
  const domain = chartDomain(rows, kind);
  const band: CustomSeriesOption = {
    id: 'selected-ci', name: 'Selected-policy pointwise 95% CI', type: 'custom', silent: true, z: 0,
    data: [0], renderItem: (_params, api) => ({ type: 'polygon',
      shape: { points: [...selected.map(r => api.coord([r.capacity_villages, r[low]])),
        ...[...selected].reverse().map(r => api.coord([r.capacity_villages, r[high]]))] },
      style: { fill: colors[state.policy], opacity: 0.14 }, }),
  };
  const series: (LineSeriesOption | CustomSeriesOption)[] = [band, ...policies.map((policy, index): LineSeriesOption => {
    const points = rows.filter(r => r.policy === policy);
    return { id: policy, name: labels[policy], type: 'line', smooth: false, animation: false, emphasis: { disabled: true },
      showSymbol: false,
      data: points.map(r => [r.capacity_villages, r[value]]),
      itemStyle: { color: colors[policy] }, lineStyle: { color: colors[policy], width: 2, type: POLICY[policy].line },
      markPoint: { symbol: ['circle', 'rect', 'triangle'][index], label: { show: false },
        data: points.filter(r => anchors.includes(r.capacity_villages as typeof anchors[number])).map(r => ({
          name: policy === state.policy && r.capacity_villages === state.k ? 'Selected capacity' : `Anchor ${r.capacity_villages}`,
          coord: [r.capacity_villages, r[value]], symbolSize: policy === state.policy && r.capacity_villages === state.k ? 12 : 6,
        })), itemStyle: { color: '#fff', borderColor: colors[policy], borderWidth: 2 } },
      markLine: index === 0 ? { silent: true, symbol: 'none', label: { formatter: `K=${state.k}`, position: 'insideEndTop' },
        lineStyle: { type: 'dashed', color: '#53627C' }, data: [{ xAxis: state.k }] } : undefined,
    };
  })];
  series.push({ id: 'reference', name: kind === 'value' ? 'Random expectation' : 'Zero-gain reference', type: 'line', symbol: 'none', emphasis: { disabled: true },
    data: rows.filter(r => r.policy === 'grf').map(r => [r.capacity_villages, kind === 'value' ? r.point_random_expected_value : 0]),
    lineStyle: { color: colors.random, type: [7, 4], width: 1.5 }, silent: true });
  return {
    animation: false, textStyle: { fontFamily: 'Segoe UI, sans-serif', color: '#081B4B' },
    grid: { left: 48, right: 24, top: 24, bottom: 54 },
    xAxis: { type: 'value', min: 0, max: 127, splitNumber: 4, name: 'Capacity (villages)', nameLocation: 'middle', nameGap: 30,
      axisLine: { onZero: false }, axisLabel: { hideOverlap: true, fontSize: 12 }, splitLine: { show: false } },
    yAxis: { type: 'value', min: domain[0], max: domain[1], axisLabel: { fontSize: 12 }, splitNumber: 4,
      splitLine: { lineStyle: { color: '#DCE4EE', type: 'dashed' } } },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, textStyle: { fontSize: 11 },
      formatter: params => {
        const items = Array.isArray(params) ? params : [params];
        const point = items.find(item => Array.isArray(item.value));
        const k = Array.isArray(point?.value) ? Number(point.value[0]) : 0;
        return tooltipText(rows, state, kind, Math.max(0, Math.min(127, Math.round(k))));
      } },
    series,
  };
}
