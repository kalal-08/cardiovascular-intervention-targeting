import { useId, useLayoutEffect, useRef, useState } from 'react';
import { init, use } from 'echarts/core';
import type { ECharts } from 'echarts/core';
import type { EChartsOption } from 'echarts';
import { LineChart, CustomChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent, MarkPointComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { Status } from '../layout';

use([LineChart, CustomChart, ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, MarkPointComponent, SVGRenderer]);
export default function EChart({ option, title, description, chartId, inspection }: {
  option: EChartsOption | null; title: string; description: string; chartId?: string; inspection?: { seriesIndex: number; dataIndex: number };
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<ECharts | null>(null);
  const previousInspection = useRef(inspection);
  const [error, setError] = useState(false);
  const available = option !== null;
  useLayoutEffect(() => {
    if (!available) return;
    let chart: ECharts;
    try { chart = init(host.current!, undefined, { renderer: 'svg' }); }
    catch { setError(true); return; }
    instance.current = chart;
    const observer = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const tooltip = (chart.getOption().tooltip as { enterable?: boolean; hideDelay?: number }[] | undefined)?.[0];
      // ECharts 6 ignores hideTip while the pointer is inside enterable rich-text content.
      if (tooltip) chart.setOption({ tooltip: { enterable: false, hideDelay: 0 } }, { silent: true });
      chart.dispatchAction({ type: 'hideTip' });
      if (tooltip) chart.setOption({ tooltip: { enterable: tooltip.enterable, hideDelay: tooltip.hideDelay } }, { silent: true });
    };
    document.addEventListener('keydown', dismiss);
    observer.observe(host.current!);
    return () => { document.removeEventListener('keydown', dismiss); observer.disconnect(); chart.dispose(); instance.current = null; };
  }, [available]);
  useLayoutEffect(() => {
    if (!option || !instance.current) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    function update() {
      try {
        const style = getComputedStyle(host.current!);
        instance.current!.setOption({ ...option, animation: motion.matches ? false : option!.animation ?? false,
          // Animated updates retain keyed series; static charts keep full replacement.
          textStyle: { fontFamily: style.fontFamily, color: style.color, ...option!.textStyle } }, { notMerge: option!.animation !== true });
        setError(false);
      } catch { setError(true); }
    }
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, [option, available]);
  useLayoutEffect(() => {
    if (inspection && (previousInspection.current?.dataIndex !== inspection.dataIndex || previousInspection.current?.seriesIndex !== inspection.seriesIndex) && instance.current && !error)
      instance.current.dispatchAction({ type: 'showTip', ...inspection });
    previousInspection.current = inspection;
  }, [inspection?.dataIndex, inspection?.seriesIndex, error]);
  return <div className="chart-frame">
    <span id={id} className="sr-only">{title}</span><span id={`${id}-description`} className="sr-only">{description}</span>
    {error && <Status kind="error">Chart unavailable. Use the accompanying data summary.</Status>}
    {!available && <Status kind="empty">No chart data available.</Status>}
    <div className="chart-surface" ref={host} data-chart={chartId} role="img" aria-labelledby={id} aria-describedby={`${id}-description`}
      hidden={!available || error} />
  </div>;
}
