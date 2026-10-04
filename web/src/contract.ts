export const PAGES = [
  { route: '/overview', label: 'Overview', title: 'Trial Evidence Overview' },
  { route: '/risk-vs-benefit', label: 'Risk vs Benefit', title: 'Risk vs Benefit' },
  { route: '/hte-validation', label: 'HTE Validation', title: 'HTE Validation' },
  { route: '/rollout', label: 'Rollout', title: 'Rollout Across Capacity' },
  { route: '/robustness', label: 'Robustness', title: 'Robustness and Village Prioritization' },
] as const;

export type PageRoute = (typeof PAGES)[number]['route'];
export type Policy = 'grf' | 'simple' | 'baseline_risk';
export type CapacityK = 13 | 32 | 64 | 95 | 127;
export type CoverageDimension = 'age' | 'sex' | 'income' | 'education' | 'occupation';
export type SortDirection = 'asc' | 'desc';
export type SortField = 'village' | 'focus' | 'grfRank' | 'grfBenefit' | 'simpleRank'
  | 'simpleBenefit' | 'baselineRank' | 'baselineRisk' | 'participants';
export type Page2State = Readonly<{ signal: 'grf' | 'simple' }>;
export type Page4State = Readonly<{ policy: Policy; k: CapacityK }>;
export type Page5State = Page4State & Readonly<{
  dimension: CoverageDimension; sort: SortField; direction: SortDirection;
}>;

export const DEFAULTS = {
  '/risk-vs-benefit': { signal: 'grf' } satisfies Page2State,
  '/rollout': { policy: 'simple', k: 64 } satisfies Page4State,
  '/robustness': {
    policy: 'simple', k: 64, dimension: 'age', sort: 'focus', direction: 'asc',
  } satisfies Page5State,
} as const;

export function resolveRoute(pathname: string): PageRoute | null {
  if (pathname === '/') return '/overview';
  return PAGES.find(page => page.route === pathname)?.route ?? null;
}
