import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import { PAGES } from '../contract';
import type { PageRoute } from '../contract';
import type { usePageNavigation } from '../navigation';

export function AppShell({ navigation, children }: { navigation: ReturnType<typeof usePageNavigation>; children: ReactNode }) {
  const navigationHelp = useId();
  const index = PAGES.findIndex(page => page.route === navigation.route);
  const link = (route: PageRoute) => ({ href: navigation.href(route), 'data-report-page': route, 'aria-describedby': navigationHelp, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => navigation.navigate(event, route, event.detail ? 'header' : 'link') });
  return <>
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="header" ref={navigation.header} tabIndex={-1} aria-label="Report header" aria-describedby={navigationHelp} onClick={navigation.headerClick} onBlur={navigation.headerBlur} onKeyDown={navigation.headerKeyDown}><div className="header-inner">
      <div className="brand"><p className="product">Cardiovascular Intervention Targeting</p><p className="subtitle">Village-level causal decision analytics</p></div>
      <nav aria-label="Report pages">
        <span id={navigationHelp} className="sr-only">Click the report header or focus a page link to use Left and Right arrow keys to change pages. Up and Down scroll normally. Leaving the header ends page-key navigation.</span>
        <span className="adjacent">{index > 0 && <a {...link(PAGES[index - 1].route)} aria-label={`Previous page: ${PAGES[index - 1].label}`}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12H4m6-6-6 6 6 6" /></svg></a>}</span>
        <div className="report-tabs">{PAGES.map(page => <a key={page.route} {...link(page.route)} ref={page.route === navigation.route ? navigation.activePageLink : undefined} aria-current={page.route === navigation.route ? 'page' : undefined}>{page.label}</a>)}</div>
        <span className="adjacent">{index >= 0 && index < PAGES.length - 1 && <a {...link(PAGES[index + 1].route)} aria-label={`Next page: ${PAGES[index + 1].label}`}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></a>}</span>
      </nav>
      <div className="report-context"><span>Aggregate evidence</span><span>127 randomized villages</span></div>
    </div></header>
    <main id="content" className={`content${index >= 0 && index <= 3 ? ' report-fit' : ''}`} tabIndex={-1}>{children}</main>
  </>;
}
export function PageHeader({ title, subtitle, heading, children }: { title: string; subtitle?: string; heading?: Ref<HTMLHeadingElement>; children?: ReactNode }) {
  return <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{children}</div>;
}
export function Panel({ title, id, children, className = '' }: { title: string; id?: string; children: ReactNode; className?: string }) {
  const generated = useId();
  const titleId = id ?? generated;
  return <section className={`panel ${className}`} aria-labelledby={titleId}><h2 id={titleId}>{title}</h2>{children}</section>;
}
export function KPIBlock({ label, value, support }: { label: ReactNode; value: ReactNode; support?: ReactNode }) {
  return <div className="kpi"><dt>{label}</dt><dd>{value}</dd>{support && <p className="kpi-support">{support}</p>}</div>;
}
export function Status({ kind, children }: { kind: 'loading' | 'error' | 'empty' | 'notice'; children: ReactNode }) {
  return <p className={`status status-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>;
}
