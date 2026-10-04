import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGES } from '../src/contract.ts';
import { PAGE_DEFAULTS, pageURL, parsePageState } from '../src/state.ts';
import { POLICY, CAPACITY_DOMAIN, anchors, isCurveCapacity } from '../src/metadata.ts';
import { count, decimal, percent, riskPercent, pp, effect, correlation, ci, rank } from '../src/format.ts';
import { loadDataset, loadDatasets, validateDocument } from '../src/data/load.ts';
import type { WebDatasets } from '../src/data.generated.ts';

for (const page of PAGES) {
  assert.deepEqual(parsePageState(page.route, '').state, PAGE_DEFAULTS[page.route]);
  assert.equal(pageURL(page.route, PAGE_DEFAULTS[page.route]), page.route);
  assert.deepEqual(parsePageState(page.route, '?unknown=1').rejected, []);
}
assert.deepEqual(parsePageState('/risk-vs-benefit', '?signal=simple&policy=grf').state, { signal: 'simple' });
assert.deepEqual(parsePageState('/risk-vs-benefit', '?signal=grf&signal=simple').rejected, ['signal']);
assert.deepEqual(parsePageState('/overview', '?signal=simple&policy=grf').state, {});
assert.deepEqual(parsePageState('/hte-validation', '?k=127').state, {});
assert.equal(pageURL('/rollout', parsePageState('/rollout', '?policy=grf&k=95&sort=participants').state), '/rollout?policy=grf&k=95');
const manual = parsePageState('/robustness', '?policy=baseline_risk&k=127&dimension=income&sort=participants&direction=desc').state;
assert.equal(pageURL('/robustness', manual), '/robustness?policy=baseline_risk&k=127&dimension=income&sort=participants&direction=desc');
assert.deepEqual(parsePageState('/robustness', '?k=-1&direction=wrong').rejected, ['k', 'direction']);
assert.deepEqual(CAPACITY_DOMAIN, [0, 127]);
assert.deepEqual(anchors, [13, 32, 64, 95, 127]);
for (const value of [-1, 0.5, 128, NaN]) assert.equal(isCurveCapacity(value), false);
assert.equal(isCurveCapacity(127), true);
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
for (const policy of Object.values(POLICY)) assert(css.includes(`${policy.token}: ${policy.color}`));
assert.equal(count(4533), '4,533'); assert.equal(count(null), 'Unavailable');
assert.equal(rank(127), '127'); assert.equal(rank(0), 'Unavailable');
assert.equal(percent(0.507), '50.7%'); assert.equal(riskPercent(20.77), '20.77%');
assert.equal(decimal(21.595, 2), '21.59');
assert.equal(pp(0.139, 4, true), '+0.1390 pp'); assert.equal(effect(-1.879981665), '-1.880 pp');
assert.equal(correlation(0.4649), '0.4649'); assert.equal(ci(-0.2353, 0.5103, 4), '-0.2353 to 0.5103');
assert.equal(decimal(-0, 4), '0.0000'); assert.equal(pp(Infinity), 'Unavailable');
assert.equal(ci(null, 1), 'Unavailable'); assert.equal(percent(NaN), 'Unavailable');

const names = ['overview', 'villages', 'validation', 'subgroups', 'rollout', 'anchors', 'overlap', 'robustness', 'coverage', 'policies', 'capacities'] as const;
const source = (name: string) => readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8');
const schemas = JSON.parse(source('schemas'));
const village = JSON.parse(source('villages'));
const extra = structuredClone(village); extra.rows[0].private_field = 'denied';
assert.throws(() => validateDocument('villages', extra, schemas.$defs.villages), /Unexpected/);
const duplicate = structuredClone(village); duplicate.rows[1] = duplicate.rows[0];
assert.throws(() => validateDocument('villages', duplicate, schemas.$defs.villages), /Duplicate/);
const badValue = structuredClone(village); badValue.rows[0].baseline_risk = Infinity;
assert.throws(() => validateDocument('villages', badValue, schemas.$defs.villages), /value/);
assert.throws(() => validateDocument('villages', { ...village, schema_version: 'wrong' }, schemas.$defs.villages), /shape/);
const originalFetch = globalThis.fetch;
const requests: string[] = [];
try {
  globalThis.fetch = async input => {
    const name = String(input).split('/').at(-1)!.replace('.json', '');
    requests.push(name);
    return new Response(source(name), { headers: { 'Content-Type': 'application/json' } });
  };
  const [data, again] = await Promise.all([loadDatasets(names), loadDatasets(names)]);
  assert.deepEqual(data, again);
  assert.equal(await loadDataset('villages'), data.villages);
  assert.equal(requests.length, 13);
  for (const name of [...names, 'manifest', 'schemas']) assert.equal(requests.filter(value => value === name).length, 1);
  for (const name of names) validateDocument(name, data[name] as WebDatasets[typeof name], schemas.$defs[name]);
  // Fresh module instances exercise failure paths without adding a cache-reset production API.
  globalThis.fetch = async input => {
    const name = String(input).split('/').at(-1)!.replace('.json', '');
    const body = name === 'villages' ? JSON.stringify({ ...village, rows: duplicate.rows }) : source(name);
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  };
  const corrupted = await import('../src/data/load.ts' + '?case=corrupted');
  await assert.rejects(corrupted.loadDataset('villages'), /integrity/);
  globalThis.fetch = async () => new Response('{"schema_version":"wrong"}', { headers: { 'Content-Type': 'application/json' } });
  const unsupported = await import('../src/data/load.ts' + '?case=version');
  await assert.rejects(unsupported.loadDataset('overview'), /version/);
  globalThis.fetch = async () => new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } });
  const failed = await import('../src/data/load.ts' + '?case=network');
  await assert.rejects(failed.loadDataset('overview'), /could not be loaded/);
} finally { globalThis.fetch = originalFetch; }
console.log('PASS: canonical page-scoped URL/defaults, metadata/tokens, capacities, units/formatting; all 11 typed datasets, shared cache, schema and integrity/version/network failures.');
