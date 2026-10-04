import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const owner = new URL('../src/pages/hte-validation-view.ts', import.meta.url);
assert(existsSync(owner), 'Page-3 source-backed evidence mapping is not implemented');
const { hteValidationView, intervalPosition } = await import(owner.href);
const validation = JSON.parse(readFileSync(new URL('../public/data/validation.json', import.meta.url), 'utf8')).rows;
const subgroups = JSON.parse(readFileSync(new URL('../public/data/subgroups.json', import.meta.url), 'utf8')).rows;
const before = JSON.stringify({ validation, subgroups });
const view = hteValidationView(validation, subgroups);
assert.deepEqual(view.autoc.map((row: any) => [row.model_or_comparison, row.estimate.toFixed(4), row.ci_lower.toFixed(4), row.ci_upper.toFixed(4)]), [
  ['grf', '0.6382', '0.1131', '1.1634'], ['simple', '0.7310', '0.3434', '1.1186'],
  ['baseline_risk', '0.8818', '0.3345', '1.4291'], ['random', '0.0213', '-0.2512', '0.2938'],
]);
assert.deepEqual(view.calibration.map((row: any) => [row.model_or_comparison, row.estimate.toFixed(4), row.ci_lower.toFixed(4), row.ci_upper.toFixed(4)]), [
  ['grf', '0.9160', '0.1510', '1.6810'], ['simple', '0.8820', '0.4707', '1.2934'],
]);
assert.deepEqual(view.agreement.map((row: any) => row.estimate.toFixed(4)), ['0.6191', '0.7249', '0.6820']);
assert.equal(view.support.classification, 'SUPPORTED');
assert.equal(view.comparisonSummary, 'SUPERIORITY NOT DEMONSTRATED');
assert.equal(view.comparisons.length, 2);
assert.equal(view.subgroups.length, 13);
for (const [index, row] of view.subgroups.entries()) {
  assert.deepEqual(row, subgroups[index]);
  assert(row.ci_lower <= row.treatment_effect && row.treatment_effect <= row.ci_upper);
}
assert.equal(intervalPosition(0, [-0.5, 1.5]), 25);
assert.equal(intervalPosition(1, [0, 1.8]), 100 / 1.8);
assert.equal(intervalPosition(-1.8799816659919089, [-4, 1]), (-1.8799816659919089 + 4) / 5 * 100);
assert.equal(intervalPosition(-4, [-4, 1]), 0); assert.equal(intervalPosition(1, [-4, 1]), 100);
assert.deepEqual(hteValidationView([...validation].reverse(), [...subgroups].reverse()), view, 'Source file order must not scramble approved rows');
const changed = validation.map((row: any) => row.validation_id === 'rate:within_fold:AUTOC:grf' ? { ...row, estimate: 0.7 } : row);
assert.equal(hteValidationView(changed, subgroups).autoc[0].estimate, 0.7, 'Render mapping must remain source-bound');
const changedN = subgroups.map((row: any, index: number) => index === 0 ? { ...row, analysis_n: 4507 } : row);
assert.equal(hteValidationView(validation, changedN).subgroups[0].analysis_n, 4507);
const comparison = validation.map((row: any) => row.validation_id === 'evidence:grf_vs_baseline_risk' ? { ...row, classification: 'SUPPORTED' } : row);
assert.equal(hteValidationView(comparison, subgroups).comparisonSummary, null, 'Never infer a consolidated limitation from only one comparison');
assert.equal(hteValidationView([], []), null);
assert.throws(() => hteValidationView(validation, subgroups.slice(1)), /subgroup/);
assert.throws(() => hteValidationView(validation, [...subgroups.slice(0, 12), subgroups[0]]), /subgroup/);
assert.throws(() => hteValidationView(validation.filter((row: any) => row.validation_id !== 'calibration:grf'), subgroups), /calibration/);
assert.throws(() => hteValidationView(validation.map((row: any) => row.metric === 'AUTOC' ? { ...row, estimate: null } : row), subgroups), /AUTOC/);
assert.throws(() => hteValidationView(validation.map((row: any) => row.metric === 'AUTOC' ? { ...row, normalization: 'raw_participant_scores' } : row), subgroups), /AUTOC/);
assert.throws(() => hteValidationView([...validation, validation.find((row: any) => row.validation_id === 'calibration:grf')], subgroups), /calibration/);
assert.equal(JSON.stringify({ validation, subgroups }), before);
console.log('PASS: Page-3 4 AUTOC / 2 calibration / 3 participant agreement / 13 source-keyed subgroups, full intervals/N, fixed scales, conditional classifications and incomplete-input guards.');
