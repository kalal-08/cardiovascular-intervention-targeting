// Retained test-harness route adapter; production owns state, metadata and selectors.
import { DEFAULTS } from '../contract.ts';
import type { Page5State } from '../contract.ts';
import { parsePageState, pageURL } from '../state.ts';
export { policies, anchors, labels, dimensions, colors, symbols } from '../metadata.ts';
export { sortFields, focusRank, sortVillages } from '../state.ts';
export { selectedPanels, frozenKPIs } from '../data/selectors.ts';
export type { ReportData as SpikeData } from '../data/selectors.ts';
export type SpikePage = 'page4' | 'page5';
export const defaults: Page5State = DEFAULTS['/robustness'];
export function readState(page: SpikePage, search: string) {
  const route = page === 'page4' ? '/rollout' : '/robustness';
  const parsed = parsePageState(route, search);
  return { page, state: { ...defaults, ...parsed.state }, rejected: parsed.rejected };
}
export function stateURL(page: SpikePage, state: Page5State) {
  const route = page === 'page4' ? '/rollout' : '/robustness';
  return pageURL(route, state).replace(route, `/__spikes/${page}`);
}
