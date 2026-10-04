import type { ReactNode, Ref } from 'react';
import type { SortDirection } from '../contract';
export function TableViewport({ label, children, className = '', viewport }: { label: string; children: ReactNode; className?: string; viewport?: Ref<HTMLDivElement> }) {
  return <div className={`table-scroll ${className}`} ref={viewport} tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
export function SortHeader({ label, accessibleLabel = label, field, direction, onSort, className = '' }: {
  label: string; accessibleLabel?: string; field: string; direction?: SortDirection; onSort: () => void; className?: string;
}) {
  return <th scope="col" aria-sort={direction ? direction === 'asc' ? 'ascending' : 'descending' : undefined} className={className}>
    <button type="button" data-sort={field} aria-label={`Sort ${accessibleLabel}`} onClick={onSort}>{label}{direction ? direction === 'asc' ? ' ↑' : ' ↓' : ''}</button>
  </th>;
}
