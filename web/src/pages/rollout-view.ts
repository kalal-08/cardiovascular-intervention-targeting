import type { AnchorsRow, OverviewRow, RolloutRow } from '../data.generated.ts';
import type { Page4State } from '../contract.ts';
import type { EChartsOption, LineSeriesOption } from 'echarts';
import { anchors, colors, labels, policies, POLICY } from '../metadata.ts';
import { count, decimal, ci } from '../format.ts';
import { chartOption, chartFields } from '../components/charts/rollout.ts';
import type { ChartKind } from '../components/charts/rollout.ts';

export function rolloutView(rows: readonly RolloutRow[], fixed: readonly AnchorsRow[], overview: readonly OverviewRow[], state: Page4State) {
  if (rows.length !== 384 || fixed.length !== 15 || overview.length !== 1
    || policies.some(policy => new Set(rows.filter(r => r.policy === policy).map(r => r.capacity_villages)).size !== 128
      || anchors.some(k => !fixed.some(r => r.policy === policy && r.capacity_villages === k))))
    throw new Error('Required frozen rollout records are unavailable.');
  const selected = fixed.find(r => r.policy === state.policy && r.capacity_villages === state.k)!;
  const matrix = [...policies.map(policy => ({ policy, label: labels[policy],
    values: anchors.map(k => fixed.find(r => r.policy === policy && r.capacity_villages === k)!.point_population_rollout_value) })),
  { policy: 'random' as const, label: 'Random expectation', values: anchors.map(k => fixed.find(r => r.policy === 'grf' && r.capacity_villages === k)!.point_random_expected_value) }];
  return { selected, matrix, randomizedTotal: overview[0].randomized_participants,
    evaluationTotal: overview[0].evaluation_participants, villagesTotal: overview[0].villages };
}

export function rolloutTooltip(rows: readonly RolloutRow[], state: Page4State, kind: ChartKind, k: number) {
  const [value, low, high] = chartFields(kind);
  // Policy names are allowlisted metadata; all inserted data fields are formatted numbers.
  const content = policies.map(policy => {
    const row = rows.find(r => r.policy === policy && r.capacity_villages === k)!;
    const textColor = policy === 'simple' ? 'var(--policy-simple-text)' : colors[policy];
    return `<tr><th scope="row"><span style="color:${textColor}">${POLICY[policy].symbol} ${labels[policy]}</span></th><td>${count(row.n_selected_randomized)}</td><td>${decimal(row[value], 4, kind === 'gain')}<br><span class="rollout-tooltip-ci">${ci(row[low], row[high], 4)}</span></td></tr>`;
  }).join('');
  const reference = rows.find(r => r.policy === 'grf' && r.capacity_villages === k)!;
  return `<div class="rollout-tooltip" role="tooltip"><strong>Capacity K=${k}</strong><p>Selected: ${labels[state.policy]} · K=${state.k}</p><table><thead><tr><th>Policy</th><th>Covered</th><th>${kind === 'value' ? 'Value' : 'Gain'} / 95% CI (pp)</th></tr></thead><tbody>${content}</tbody></table>${kind === 'value' ? `<p class="rollout-tooltip-reference">Random expectation: ${decimal(reference.point_random_expected_value, 4)} pp</p>` : ''}</div>`;
}

export function rolloutChart(rows: readonly RolloutRow[], state: Page4State, kind: ChartKind): EChartsOption {
  const option = chartOption(rows, state, kind);
  return { ...option,
    series: (option.series as LineSeriesOption[]).map((series): LineSeriesOption => !policies.includes(series.id as typeof policies[number]) ? {
      ...series, ...(series.id === 'reference' && kind === 'value' ? { markPoint: { silent: true, symbol: 'diamond', symbolSize: 6,
        label: { show: false }, itemStyle: { color: colors.random },
        data: rows.filter(row => row.policy === 'grf' && anchors.includes(row.capacity_villages as typeof anchors[number]))
          .map(row => ({ name: `Random anchor ${row.capacity_villages}`, coord: [row.capacity_villages, row.point_random_expected_value] })) } } : {}),
    } : {
      ...series, ...(series.markLine ? { markLine: { ...series.markLine, label: { ...series.markLine.label, rotate: 0 } } } : {}),
      markPoint: { ...series.markPoint, data: series.markPoint!.data!.map(point => {
        const [k, estimate] = (point as { coord: number[] }).coord;
        const endpoint = series.id === 'grf' && k === 127;
        return { ...point, itemStyle: { color: series.id === state.policy && k === state.k ? '#fff' : colors[series.id as typeof policies[number]],
          borderColor: colors[series.id as typeof policies[number]], borderWidth: series.id === state.policy && k === state.k ? 2 : 1 },
          label: { show: endpoint || (series.id === state.policy && k === state.k && k !== 127),
          formatter: endpoint ? `All policies converge\n${decimal(estimate, 4)} pp` : decimal(estimate, 4, kind === 'gain'),
          position: 'top', align: endpoint ? 'right' : 'center', offset: endpoint ? [-8, 0] : [0, 0], distance: 8, fontSize: 12, color: '#081B4B' } };
      }) },
    }),
    grid: { left: 60, right: 22, top: 22, bottom: 54 },
    xAxis: { ...option.xAxis as object, min: 0, max: 127, name: 'Rollout capacity (randomized villages)', nameGap: 32,
      axisLabel: { hideOverlap: true, fontSize: 13, customValues: [0, ...anchors] }, axisTick: { show: true, customValues: [0, ...anchors] },
      splitLine: { show: true, lineStyle: { color: '#E8EDF4', type: 'dashed', width: 1 } },
      axisLine: { onZero: false, lineStyle: { color: '#53627C' } } },
    yAxis: { ...option.yAxis as object, min: kind === 'value' ? -.2 : -.6, max: kind === 'value' ? 2.8 : .8,
      name: kind === 'value' ? 'Population rollout value (pp)' : 'Gain versus random (pp)', nameLocation: 'middle', nameGap: 40,
      axisLabel: { fontSize: 13, formatter: (n: number) => n.toFixed(1) }, nameTextStyle: { fontSize: 13, color: '#53627C' } },
    tooltip: { trigger: 'axis', renderMode: 'html', appendTo: 'body', confine: false, enterable: true, hideDelay: 120,
      displayTransition: false, transitionDuration: 0,
      backgroundColor: '#F8FAFC', borderColor: '#DCE4EE', borderWidth: 1, padding: 8,
      textStyle: { fontFamily: 'Segoe UI', fontSize: 13, color: '#081B4B' },
      extraCssText: 'border-radius:4px;box-shadow:0 2px 8px #081b4b14;max-width:calc(100vw - 48px);white-space:normal;',
      position: (point, _params, _element, _rect, size) => {
        const [w, h] = size.contentSize;
        const host = document.querySelector(`[data-chart="rollout-${kind}"]`)!.getBoundingClientRect();
        // Native HTML tips may extend above the plot; clamp against the actual viewport, not the chart height.
        const x = host.left + point[0] + w + 18 < innerWidth - 8 ? point[0] + 18 : point[0] - w - 18;
        const y = host.top + point[1] - h - 14 >= 8 ? point[1] - h - 14 : point[1] + 18;
        return [Math.max(8 - host.left, Math.min(innerWidth - host.left - w - 8, x)),
          Math.max(8 - host.top, Math.min(innerHeight - host.top - h - 8, y))];
      },
      formatter: params => {
        const items = Array.isArray(params) ? params : [params];
        const point = items.find(item => Array.isArray(item.value));
        const k = Array.isArray(point?.value) ? Number(point.value[0]) : 0;
        return rolloutTooltip(rows, state, kind, Math.max(0, Math.min(127, Math.round(k))));
      } },
  };
}
