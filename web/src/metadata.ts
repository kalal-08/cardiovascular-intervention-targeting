import type { Policy } from './contract.ts';
export const POLICY = {
  grf: { label: 'GRF', color: '#0B2E83', token: '--policy-grf', symbol: '●', line: 'solid' },
  simple: { label: 'Simple HTE', color: '#0798A5', token: '--policy-simple', symbol: '□', line: 'dashed' },
  baseline_risk: { label: 'Baseline Risk', color: '#F28C00', token: '--policy-baseline-risk', symbol: '▲', line: 'dotted' },
  random: { label: 'Random expectation', color: '#7B8494', token: '--reference', symbol: '◇', line: 'dashed' },
} as const;
export const policies: readonly Policy[] = ['grf', 'simple', 'baseline_risk'];
export const anchors = [13, 32, 64, 95, 127] as const;
export const CAPACITY_DOMAIN = [0, 127] as const;
export function isCurveCapacity(value: number) { return Number.isInteger(value) && value >= 0 && value <= 127; }
export const dimensions = { age: 'Age', sex: 'Sex', income: 'Annual household income', education: 'Education', occupation: 'Occupation' };
export const labels = { grf: POLICY.grf.label, simple: POLICY.simple.label, baseline_risk: POLICY.baseline_risk.label };
export const colors = { grf: POLICY.grf.color, simple: POLICY.simple.color, baseline_risk: POLICY.baseline_risk.color, random: POLICY.random.color };
export const symbols = { grf: POLICY.grf.symbol, simple: POLICY.simple.symbol, baseline_risk: POLICY.baseline_risk.symbol };
