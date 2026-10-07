import { lazy, Suspense } from 'react';
import { PAGES } from './contract';
import { usePageNavigation } from './navigation';
import { AppShell, PageHeader, Panel, Status } from './components/layout';
import { loadDatasets } from './data/load';
import type { WebDatasets } from './data.generated';

function requestedPage<T>(code: Promise<T>, names: readonly (keyof WebDatasets)[]): Promise<T> {
  // Page effects consume the same verified cache and own data-error presentation.
  void loadDatasets(names).catch(() => {});
  return code;
}
const Overview = lazy(() => requestedPage(import('./pages/Overview'), ['overview']));
const RiskBenefit = lazy(() => requestedPage(import('./pages/RiskBenefit'), ['villages', 'validation']));
const HTEValidation = lazy(() => requestedPage(import('./pages/HTEValidation'), ['validation', 'subgroups']));
const Rollout = lazy(() => requestedPage(import('./pages/Rollout'), ['rollout', 'anchors', 'overview']));
const Robustness = lazy(() => requestedPage(import('./pages/Robustness'), ['overview', 'villages', 'anchors', 'overlap', 'robustness', 'coverage']));

export default function App() {
  const navigation = usePageNavigation();
  const page = PAGES.find(item => item.route === navigation.route);
  if (navigation.route === '/overview') return <AppShell navigation={navigation}>
    <Suspense fallback={<><PageHeader title="Trial Evidence Overview" heading={navigation.heading} /><Status kind="loading">Loading frozen summary…</Status></>}>
      <Overview heading={navigation.heading} />
    </Suspense>
  </AppShell>;
  if (navigation.route === '/risk-vs-benefit') return <AppShell navigation={navigation}>
    <Suspense fallback={<><PageHeader title="Risk vs Predicted Benefit" heading={navigation.heading} /><Status kind="loading">Loading frozen village signals…</Status></>}>
      <RiskBenefit navigation={navigation} />
    </Suspense>
  </AppShell>;
  if (navigation.route === '/hte-validation') return <AppShell navigation={navigation}>
    <Suspense fallback={<><PageHeader title="HTE Validation" heading={navigation.heading} /><Status kind="loading">Loading frozen HTE evidence…</Status></>}>
      <HTEValidation heading={navigation.heading} />
    </Suspense>
  </AppShell>;
  if (navigation.route === '/rollout') return <AppShell navigation={navigation}>
    <Suspense fallback={<><PageHeader title="Rollout Across Capacity" heading={navigation.heading} /><Status kind="loading">Loading frozen rollout evidence…</Status></>}>
      <Rollout navigation={navigation} />
    </Suspense>
  </AppShell>;
  if (navigation.route === '/robustness') return <AppShell navigation={navigation}>
    <Suspense fallback={<><PageHeader title="Robustness and Village Prioritization" heading={navigation.heading} /><Status kind="loading">Loading frozen robustness evidence…</Status></>}>
      <Robustness navigation={navigation} />
    </Suspense>
  </AppShell>;
  return <AppShell navigation={navigation}>
    <PageHeader title={page?.title ?? 'Page not found'} heading={navigation.heading} />
    {navigation.rejected.length > 0 && <Status kind="notice">Invalid state reset to defaults: {navigation.rejected.join(', ')}.</Status>}
    <Panel title="Local foundation · not the final dashboard" className="placeholder">
      <p>Shared architecture is ready. Analytical content is not implemented.</p>
      {!page && <a href="/overview" onClick={event => navigation.navigate(event, '/overview')}>Return to Overview</a>}
    </Panel>
  </AppShell>;
}
