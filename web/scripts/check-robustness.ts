import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/contract.ts';
import { dimensions, policies, anchors } from '../src/metadata.ts';
import { page5View, validatePage5, gainPosition, sensitivityFindings } from '../src/pages/robustness-view.ts';
import type { Page5Inputs } from '../src/pages/robustness-view.ts';

const names = ['overview', 'villages', 'anchors', 'overlap', 'robustness', 'coverage'] as const;
const data = Object.fromEntries(names.map(name => [name, JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))])) as Page5Inputs;
const before = JSON.stringify(data);
validatePage5(data);
assert.equal(gainPosition(-.7), 0); assert.equal(gainPosition(0), 50); assert.equal(gainPosition(.7), 100);
let states = 0;
for (const policy of policies) for (const k of anchors) for (const dimension of Object.keys(dimensions) as (keyof typeof dimensions)[]) {
  const view = page5View(data, { ...DEFAULTS['/robustness'], policy, k, dimension });
  assert.equal(view.coverage.length, 2); assert.equal(view.overlap.length, 3);
  assert(view.coverage.every(r => r.policy === policy && r.capacity_villages === k && r.dimension === dimension));
  assert.deepEqual(view.overlap.map(r => `${r.policy_left}|${r.policy_right}`), ['grf|simple', 'grf|baseline_risk', 'simple|baseline_risk']);
  for (const row of view.overlap) assert.deepEqual(row, data.overlap.rows.find(r => r.comparison === row.comparison && r.capacity_villages === k));
  if (k === 127) assert.equal(view.robustness, undefined);
  else {
    const r = view.robustness!;
    assert(r.phase11a_gain_ci_lower <= 0 && r.phase11a_gain_ci_upper >= 0);
    assert.equal(sensitivityFindings(r)[2][1], r.single_village_influence === 'ROBUST TO SINGLE-VILLAGE DELETION' ? 'Robust' : 'Sensitive');
  }
  if (k === 64 && policy !== 'baseline_risk') assert.equal(view.anchor.n_selected_randomized, policy === 'grf' ? 2300 : 2299);
  states++;
}
for (const corrupt of [
  (d: any) => { d.villages.rows.pop(); },
  (d: any) => { d.villages.rows[0].grf_candidate_rank = 0; },
  (d: any) => { d.coverage.rows.pop(); },
  (d: any) => { d.coverage.rows[0].n_overall_covered++; },
  (d: any) => { d.overlap.rows.pop(); },
  (d: any) => { d.robustness.rows[0].phase11a_gain_ci_upper = 2; },
]) { const broken = JSON.parse(before); corrupt(broken); assert.throws(() => validatePage5(broken)); }
assert.equal(JSON.stringify(data), before);
console.log(`PASS: ${states} production Page-5 source states, fixed scale, state-specific findings, full-capacity reconciliation, coverage totals, incomplete/corrupt guards and source immutability.`);
