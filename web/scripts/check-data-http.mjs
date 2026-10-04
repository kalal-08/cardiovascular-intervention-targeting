// Local static-data and public-build boundary check; never deploys or authenticates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4173');
assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only local verification is permitted');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = await readdir(new URL('public/data/', root));
const manifest = JSON.parse(await readFile(new URL('public/data/manifest.json', root), 'utf8'));
for (const name of files) {
  const expected = await readFile(new URL(`public/data/${name}`, root));
  const response = await fetch(new URL(`/data/${name}`, base));
  assert.equal(response.status, 200, name);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/, name);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes), digest(expected), `Stale HTTP data: ${name}`);
  const document = JSON.parse(bytes);
  const entry = manifest.datasets[document.schema_name];
  if (entry) {
    assert.equal(document.rows.length, entry.rows, name);
    assert.equal(digest(bytes), entry.sha256, name);
  }
}
for (const path of ['/overview', '/risk-vs-benefit', '/hte-validation', '/rollout', '/robustness',
                    '/wrangler.json', '/.dev.vars', '/Cardiovascular_Intervention_Targeting.pbix']) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/, path);
}
const directory = process.argv[3] ?? 'dist';
assert(['dist', 'dist-spikes'].includes(directory), 'Known build directories only');
const dist = new URL(`${directory}/`, root);
const ignore = await readFile(new URL('.assetsignore', dist), 'utf8');
assert(ignore.includes('wrangler.json') && ignore.includes('.dev.vars'), 'Private build configuration exclusion');
let publicFiles = 0;
for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || ['wrangler.json', '.assetsignore'].includes(entry.name)) continue;
  const path = join(entry.parentPath, entry.name);
  const name = relative(fileURLToPath(dist), path).replaceAll('\\', '/');
  assert(name === 'index.html' || /^assets\/[^/]+\.(js|css)$/.test(name)
         || name.startsWith('data/') && files.includes(name.slice(5)), `Unapproved public file: ${name}`);
  const content = await readFile(path, 'utf8');
  assert(!/\b[A-Za-z]:[\\/]|\/(?:Users|home)\/|participant_id|source_system_id|BEGIN [A-Z ]*PRIVATE KEY|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}/.test(content), `Private-content marker: ${name}`);
  if (name.startsWith('data/')) assert.equal(digest(Buffer.from(content)), digest(await readFile(new URL(`public/${name}`, root))), name);
  publicFiles++;
}
console.log(`PASS: ${files.length} byte-identical JSON HTTP responses; five direct routes; private-file fallback; ${publicFiles} approved public build files. Non-public Wrangler metadata excluded.`);
