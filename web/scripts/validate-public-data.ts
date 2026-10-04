import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument } from '../src/data/load.ts';
import type { WebDatasets } from '../src/data.generated.ts';

const directory = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../public/data/', import.meta.url));
const counts = { overview: 1, villages: 127, validation: 15, subgroups: 13, rollout: 384,
  anchors: 15, overlap: 15, robustness: 12, coverage: 150, policies: 3, capacities: 128 } as const;
const names = Object.keys(counts) as (keyof WebDatasets)[];
const read = (file: string) => readFileSync(resolve(directory, file));
const manifest = JSON.parse(read('manifest.json').toString());
assert.equal(manifest.schema_version, '1.0.0', 'Unsupported public data version');
assert.equal(manifest.export_version, '1.0.0');
assert.equal(manifest.contract_version, '12C.0');
assert.deepEqual(Object.keys(manifest.datasets).sort(), [...names].sort(), 'Unexpected public datasets');
assert.deepEqual(readdirSync(directory).sort(), ['manifest.json', 'schemas.json', ...names.map(name => `${name}.json`)].sort(),
  'Unexpected public data file set');
const checked = (file: string, hash: string) => {
  assert.match(hash, /^[a-f0-9]{64}$/, 'Invalid public data fingerprint');
  const bytes = read(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `Public data integrity failed: ${file}`);
  return JSON.parse(bytes.toString());
};
assert.equal(manifest.schemas.file, 'schemas.json');
const schemas = checked('schemas.json', manifest.schemas.sha256);
assert.equal(schemas.schema_version, '1.0.0');
assert.deepEqual(Object.keys(schemas.$defs).sort(), [...names].sort());
for (const name of names) {
  const entry = manifest.datasets[name];
  assert.equal(entry.file, `${name}.json`);
  assert.equal(entry.schema, name);
  assert.equal(entry.rows, counts[name]);
  assert.equal(schemas.$defs[name].properties.rows.minItems, counts[name]);
  assert.equal(schemas.$defs[name].properties.rows.maxItems, counts[name]);
  assert.match(entry.source.sha256, /^[a-f0-9]{64}$/);
  const document = checked(`${name}.json`, entry.sha256);
  assert.deepEqual(Object.keys(document).sort(), ['rows', 'schema_name', 'schema_version']);
  validateDocument(name, document, schemas.$defs[name]);
}
for (const field of ['source_group_sha256', 'dictionary_sha256', 'targets_sha256']) {
  assert.match(manifest[field], /^[a-f0-9]{64}$/, 'Missing public provenance fingerprint');
}
// This checks approved assets, not a new scientific reproduction or trusted signature.
console.log('PASS: 13 public assets; manifest/schema versions, file set, hashes, row counts, fields, types and keys. Private source reconciliation remains data:validate.');
