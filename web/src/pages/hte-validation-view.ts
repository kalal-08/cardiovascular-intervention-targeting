import type { ValidationRow, SubgroupsRow } from '../data.generated.ts';

export const AUTOC_DOMAIN = [-0.5, 1.5] as const;
export const CALIBRATION_DOMAIN = [0, 1.8] as const;
export const SUBGROUP_DOMAIN = [-4, 1] as const;
export type IntervalRow = ValidationRow & { estimate: number; ci_lower: number; ci_upper: number };
export function intervalPosition(value: number, domain: readonly [number, number]) {
  return (value - domain[0]) / (domain[1] - domain[0]) * 100;
}

// Explicit source keys preserve approved order even when an export changes file order.
export function hteValidationView(validation: readonly ValidationRow[], subgroups: readonly SubgroupsRow[]) {
  if (!validation.length && !subgroups.length) return null;
  function required(ids: readonly ValidationRow['validation_id'][], metric: ValidationRow['metric'], normalization: ValidationRow['normalization']) {
    return ids.map(id => {
      const found = validation.filter(row => row.validation_id === id);
      if (found.length !== 1 || found[0].metric !== metric || found[0].normalization !== normalization)
        throw new Error(`Frozen ${metric} records are incomplete.`);
      return found[0];
    });
  }
  function intervals(ids: readonly ValidationRow['validation_id'][], metric: ValidationRow['metric'], normalization: ValidationRow['normalization'], unit: ValidationRow['unit']) {
    return required(ids, metric, normalization).map(row => {
      if (row.unit !== unit || ![row.estimate, row.ci_lower, row.ci_upper].every(value => value !== null && Number.isFinite(value))
          || row.ci_lower! > row.estimate! || row.estimate! > row.ci_upper!)
        throw new Error(`Frozen ${metric} intervals are unavailable.`);
      return row as IntervalRow;
    });
  }
  const autoc = intervals(['rate:within_fold:AUTOC:grf', 'rate:within_fold:AUTOC:simple', 'rate:within_fold:AUTOC:baseline_risk', 'rate:within_fold:AUTOC:random'], 'AUTOC', 'within_fold', 'validation score');
  const calibration = intervals(['calibration:grf', 'calibration:simple'], 'calibration_slope', 'fold_adjusted', 'slope');
  const agreement = required(['participant_spearman:grf_vs_simple', 'participant_spearman:grf_vs_baseline_risk', 'participant_spearman:simple_vs_baseline_risk'], 'priority_spearman', 'raw_participant_scores').map(row => {
    if (row.unit !== 'correlation' || row.estimate === null || !Number.isFinite(row.estimate) || Math.abs(row.estimate) > 1)
      throw new Error('Frozen participant-score agreement is unavailable.');
    return row as ValidationRow & { estimate: number };
  });
  const [support, ...comparisons] = required(['evidence:grf_hte_validation', 'evidence:incremental_grf_vs_simple', 'evidence:grf_vs_baseline_risk'], 'evidence_classification', 'predeclared_rule');
  if ([support, ...comparisons].some(row => row.classification === null)) throw new Error('Frozen evidence classifications are unavailable.');
  if (subgroups.length !== 13 || new Set(subgroups.map(row => row.subgroup_effect_id)).size !== 13)
    throw new Error('Frozen subgroup records are incomplete.');
  const ordered = [...subgroups].sort((a, b) => a.subgroup_effect_id.localeCompare(b.subgroup_effect_id));
  if (ordered.some((row, index) => row.subgroup_effect_id !== `subgroup_${String(index).padStart(2, '0')}`
      || !Number.isSafeInteger(row.analysis_n) || row.analysis_n < 1
      || ![row.treatment_effect, row.ci_lower, row.ci_upper].every(Number.isFinite)
      || row.ci_lower > row.treatment_effect || row.treatment_effect > row.ci_upper))
    throw new Error('Frozen subgroup values are unavailable.');
  return { autoc, calibration, agreement, support, comparisons,
    comparisonSummary: comparisons.every(row => row.classification === 'NOT DEMONSTRATED') ? 'SUPERIORITY NOT DEMONSTRATED' : null,
    subgroups: ordered };
}
