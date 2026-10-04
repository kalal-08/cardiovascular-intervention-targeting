import type { WebDatasets } from '../data.generated.ts';
import type { Page5State } from '../contract.ts';
import { percent } from '../format.ts';
export type ReportData = Pick<WebDatasets, 'overview' | 'villages' | 'rollout' | 'anchors' | 'overlap' | 'robustness' | 'coverage'>;
export function selectedPanels(data: Pick<ReportData, 'anchors' | 'coverage' | 'overlap' | 'robustness'>, state: Page5State) {
  const anchor = data.anchors.rows.find(r => r.policy === state.policy && r.capacity_villages === state.k);
  const coverage = data.coverage.rows.filter(r => r.policy === state.policy && r.capacity_villages === state.k && r.dimension === state.dimension);
  const overlap = data.overlap.rows.filter(r => r.capacity_villages === state.k);
  const robustness = data.robustness.rows.find(r => r.policy === state.policy && r.capacity_villages === state.k);
  if (!anchor || coverage.length !== 2 || overlap.length !== 3 || (state.k !== 127 && !robustness)) throw new Error('Required public records are unavailable.');
  return { anchor, coverage, overlap, robustness };
}
export function frozenKPIs(data: Pick<ReportData, 'overview' | 'overlap' | 'robustness'>) {
  return [String(data.overview.rows[0].villages),
    percent(Math.min(...data.overlap.rows.filter(r => r.capacity_villages === 64).map(r => r.jaccard_overlap))),
    `${data.robustness.rows.filter(r => r.phase11a_gain_ci_lower <= 0 && r.phase11a_gain_ci_upper >= 0).length} of ${data.robustness.rows.length}`,
    String(new Set(data.robustness.rows.filter(r => r.raw_ranking_stability === 'SENSITIVE').map(r => r.policy)).size)];
}
