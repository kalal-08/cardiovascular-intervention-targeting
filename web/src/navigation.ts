import { useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { PAGES } from './contract.ts';
import type { PageRoute } from './contract.ts';
import { PAGE_DEFAULTS, pageURL, parsePageState } from './state.ts';
import type { PageStates } from './state.ts';

export type RoutePaths = Partial<Record<PageRoute, string>>;
const canonicalPaths: RoutePaths = Object.fromEntries(PAGES.map(page => [page.route, page.route]));
export function usePageNavigation(paths: RoutePaths = canonicalPaths) {
  function readLocation() {
    const pathname = location.pathname === '/' ? '/overview' : location.pathname;
    const route = PAGES.find(page => paths[page.route] === pathname)?.route ?? null;
    return route ? parsePageState(route, location.search) : { route: null, state: {}, rejected: [] };
  }
  const [current, setCurrent] = useState(readLocation);
  const memory = useRef<Partial<PageStates>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const header = useRef<HTMLElement>(null);
  const activePageLink = useRef<HTMLAnchorElement>(null);
  const headerFocus = useRef<{ route: PageRoute; target: 'header' | 'link' } | null>(null);
  const previousRoute = useRef(current.route);
  function getState<R extends PageRoute>(route: R): PageStates[R] {
    return (current.route === route ? current.state : memory.current[route] ?? PAGE_DEFAULTS[route]) as PageStates[R];
  }
  function url<R extends PageRoute>(route: R, state: PageStates[R]) {
    return pageURL(route, state).replace(route, paths[route] ?? route);
  }
  const href = (route: PageRoute) => url(route, getState(route));
  useLayoutEffect(() => {
    const restore = () => {
      headerFocus.current = null;
      if (header.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setCurrent(readLocation());
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [paths]);
  useLayoutEffect(() => {
    if (current.route) {
      Object.assign(memory.current, { [current.route]: current.state });
      const canonical = url(current.route, current.state);
      if (location.pathname + location.search !== canonical) history.replaceState(null, '', canonical);
    }
    document.title = `${PAGES.find(page => page.route === current.route)?.label ?? 'Page not found'} — Cardiovascular Intervention Targeting`;
    // Consume header focus at the route commit, not when lazy page content finishes loading.
    if (headerFocus.current && headerFocus.current.route === current.route) focusHeader(headerFocus.current.target);
    else if (previousRoute.current !== current.route) heading.current?.focus();
    headerFocus.current = null;
    previousRoute.current = current.route;
  }, [current]);
  function focusHeader(target: 'header' | 'link') {
    (target === 'header' ? header.current : activePageLink.current)?.focus({ preventScroll: true });
  }
  function activate(route: PageRoute, focusTarget: 'header' | 'link' | null = null) {
    headerFocus.current = focusTarget ? { route, target: focusTarget } : null;
    const target = href(route);
    if (target === location.pathname + location.search) {
      if (focusTarget) focusHeader(focusTarget);
      headerFocus.current = null;
      return;
    }
    history.pushState(null, '', target);
    setCurrent({ route, state: getState(route), rejected: [] });
  }
  function navigate(event: MouseEvent<HTMLAnchorElement>, route: PageRoute, focusTarget: 'header' | 'link' | null = null) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    activate(route, focusTarget);
  }
  function headerClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    headerFocus.current = null;
    focusHeader('header');
  }
  function headerBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) headerFocus.current = null;
  }
  function headerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target !== document.activeElement) return;
    if (event.target !== header.current && (!(event.target instanceof HTMLAnchorElement) || !event.target.hasAttribute('data-report-page'))) return;
    // Read the latest route even when consecutive discrete events precede a React commit.
    const index = PAGES.findIndex(page => page.route === readLocation().route);
    if (index < 0) return;
    event.preventDefault();
    const next = PAGES[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) activate(next.route, 'link');
  }
  function change<R extends PageRoute>(route: R, patch: Partial<PageStates[R]>) {
    if (current.route !== route) throw new Error('Cannot change selectors on an inactive page.');
    headerFocus.current = null;
    const next = parsePageState(route, new URL(url(route, { ...getState(route), ...patch }), location.origin).search);
    const target = url(route, next.state);
    if (target === location.pathname + location.search) return;
    history.pushState(null, '', target);
    setCurrent(next);
  }
  return { ...current, getState, href, navigate, change, heading, header, activePageLink, headerClick, headerBlur, headerKeyDown };
}
