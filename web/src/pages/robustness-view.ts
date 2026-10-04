import type { WebDatasets, RobustnessRow } from '../data.generated.ts';
import type { Page5State } from '../contract.ts';
import { DEFAULTS } from '../contract.ts';
import { anchors, dimensions, policies } from '../metadata.ts';
import { frozenKPIs, selectedPanels } from '../data/selectors.ts';

export type Page5Inputs = Pick<WebDatasets, 'overview' | 'villages' | 'anchors' | 'overlap' | 'robustness' | 'coverage'>;
export const GAIN_DOMAIN = [-.7, .7] as const;
export function gainPosition(value: number) { return (value - GAIN_DOMAIN[0]) / (GAIN_DOMAIN[1] - GAIN_DOMAIN[0]) * 100; }
export function page5View(data: Page5Inputs, state: Page5State) {
  const panels = selectedPanels(data, state);
  const pairOrder = ['grf|simple', 'grf|baseline_risk', 'simple|baseline_risk'];
  return { ...panels,
    overlap: [...panels.overlap].sort((a, b) => pairOrder.indexOf(`${a.policy_left}|${a.policy_right}`) - pairOrder.indexOf(`${b.policy_left}|${b.policy_right}`)),
    coverage: [...panels.coverage].sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0) };
}
export function validatePage5(data: Page5Inputs) {
  if (data.villages.rows.length !== 127 || new Set(data.villages.rows.map(r => r.village_id)).size !== 127
      || data.overview.rows.length !== 1 || data.overview.rows[0].randomized_participants !== 4533)
    throw new Error('Frozen Page-5 population is incomplete.');
  for (const policy of policies) {
    const ranks = data.villages.rows.map(r => r[`${policy}_candidate_rank`]).sort((a, b) => a - b);
    if (ranks.some((r, i) => r !== i + 1)) throw new Error('Frozen village ranks are incomplete.');
    for (const k of anchors) for (const dimension of Object.keys(dimensions) as Page5State['dimension'][]) {
      const view = page5View(data, { ...DEFAULTS['/robustness'], policy, k, dimension });
      const covered = view.anchor.n_selected_randomized, overall = view.anchor.randomized_coverage;
      if (view.coverage.some(r => r.n_overall_covered !== covered || r.overall_randomized_coverage !== overall
          || r.subgroup_coverage < 0 || r.subgroup_coverage > 1)
          || view.coverage.reduce((n, r) => n + r.n_subgroup_total, 0) !== 4533
          || view.coverage.reduce((n, r) => n + r.n_subgroup_covered, 0) !== covered)
        throw new Error('Frozen coverage records do not reconcile.');
      const r = view.robustness;
      if (k === 127) {
        if (r || covered !== 4533 || overall !== 1 || view.coverage.some(r => r.subgroup_coverage !== 1 || r.coverage_gap !== 0)
            || view.overlap.some(r => r.shared_villages !== 127 || r.jaccard_overlap !== 1))
          throw new Error('Full-capacity reconciliation is unavailable.');
      } else if (!r || r.phase11a_gain_ci_lower < GAIN_DOMAIN[0] || r.phase11a_gain_ci_upper > GAIN_DOMAIN[1]
          || r.phase11a_gain_ci_lower > r.phase11a_point_gain_vs_random || r.phase11a_gain_ci_upper < r.phase11a_point_gain_vs_random)
        throw new Error('Frozen robustness interval is unavailable.');
    }
  }
  if (frozenKPIs(data).join('|') !== '127|42.2%|12 of 12|3') throw new Error('Frozen headline evidence is unavailable.');
}
export function sensitivityFindings(row: RobustnessRow) {
  return [
    ['Raw ranking', row.raw_ranking_stability === 'SENSITIVE' ? 'Sensitive' : row.raw_ranking_stability, 'Ranking specification'],
    ['Equal village', row.equal_village_consistency === 'CONSISTENT' ? 'Consistent' : row.equal_village_consistency, 'Equal village weights'],
    ['Single-village influence', row.single_village_influence === 'ROBUST TO SINGLE-VILLAGE DELETION' ? 'Robust' : 'Sensitive', 'Leave-one-village-out'],
  ] as const;
}
export function coverageLabel(category: string) {
  return category === '<60 years' ? 'Under 60 years' : category === '>=60 years' ? '60 years or older' : category.replace('>=', '≥');
}
