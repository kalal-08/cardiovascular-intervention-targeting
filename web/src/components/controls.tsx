import { useId } from 'react';
export function SelectControl<T extends string | number>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  const id = useId();
  return <label className="select-control" htmlFor={id}>{label}<select id={id} aria-label={label} value={value} disabled={disabled}
    onChange={event => { const option = options.find(item => String(item.value) === event.target.value); if (option) onChange(option.value); }}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}
