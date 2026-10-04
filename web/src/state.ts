import { DEFAULTS } from './contract.ts';
import type { PageRoute, Page2State, Page4State, Page5State, Policy, SortField } from './contract.ts';
import type { VillagesRow } from './data.generated.ts';
import { policies, anchors, dimensions } from './metadata.ts';
export type PageStates = {
  '/overview': Readonly<Record<string, never>>;
  '/risk-vs-benefit': Page2State;
  '/hte-validation': Readonly<Record<string, never>>;
  '/rollout': Page4State;
  '/robustness': Page5State;
};
export const PAGE_DEFAULTS: PageStates = { '/overview': {}, '/hte-validation': {}, ...DEFAULTS };
export const sortFields: Record<SortField, keyof VillagesRow | 'focus'> = {
  village: 'village_id', focus: 'focus', grfRank: 'grf_candidate_rank', grfBenefit: 'grf_predicted_benefit',
  simpleRank: 'simple_candidate_rank', simpleBenefit: 'simple_predicted_benefit',
  baselineRank: 'baseline_risk_candidate_rank', baselineRisk: 'baseline_risk', participants: 'n_randomized',
};
export function focusRank(row: VillagesRow, policy: Policy) { return row[`${policy}_candidate_rank`]; }
export function sortVillages(rows: readonly VillagesRow[], state: Page5State): VillagesRow[] {
  const field = sortFields[state.sort];
  const value = (row: VillagesRow) => field === 'focus' ? focusRank(row, state.policy) : Number(row[field]);
  // Equal keys retain the supplied complete-row order, including prior manual sorts.
  return [...rows].sort((a, b) => (value(a) - value(b)) * (state.direction === 'asc' ? 1 : -1));
}
const choices: Record<string, readonly string[]> = {
  signal: ['grf', 'simple'], policy: policies, k: anchors.map(String), dimension: Object.keys(dimensions),
  sort: Object.keys(sortFields), direction: ['asc', 'desc'],
};
export function parsePageState<R extends PageRoute>(route: R, search: string) {
  const query = new URLSearchParams(search);
  const state = { ...PAGE_DEFAULTS[route] };
  const rejected: string[] = [];
  for (const key of Object.keys(state)) {
    const values = query.getAll(key);
    if (!values.length) continue;
    if (values.length !== 1 || !choices[key].includes(values[0])) { rejected.push(key); continue; }
    Object.assign(state, { [key]: key === 'k' ? Number(values[0]) : values[0] });
  }
  return { route, state: state as PageStates[R], rejected };
}
export function pageURL<R extends PageRoute>(route: R, state: PageStates[R]): string {
  const query = new URLSearchParams();
  for (const [key, fallback] of Object.entries(PAGE_DEFAULTS[route])) {
    const value = (state as Record<string, unknown>)[key];
    if (value !== fallback) query.set(key, String(value));
  }
  return `${route}${query.size ? `?${query}` : ''}`;
}
