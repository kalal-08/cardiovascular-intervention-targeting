const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const web = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cit-public-data-test-'));
try {
  fs.cpSync(path.join(web, 'public/data'), scratch, { recursive: true });
  const run = () => spawnSync(process.execPath,
    ['--experimental-strip-types', path.join(__dirname, 'validate-public-data.ts'), scratch], { encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifestPath = path.join(scratch, 'manifest.json');
  const manifest = fs.readFileSync(manifestPath);
  const villagePath = path.join(scratch, 'villages.json');
  const villages = fs.readFileSync(villagePath);
  const reset = () => { fs.writeFileSync(manifestPath, manifest); fs.writeFileSync(villagePath, villages); };
  fs.appendFileSync(villagePath, ' ');
  result = run();
  assert.notEqual(result.status, 0, 'Changed bytes must fail integrity validation');
  assert.match(result.stderr, /integrity/i);
  reset();

  // Updating the manifest hash must not bypass the existing field/type/key validator.
  for (const mutate of [
    document => { document.rows[0].participant_id = 'rejected-fixture'; },
    document => { document.rows[1] = document.rows[0]; },
    document => { document.rows[0].baseline_risk = 'invalid'; },
  ]) {
    const document = JSON.parse(villages);
    mutate(document);
    const bytes = Buffer.from(JSON.stringify(document));
    fs.writeFileSync(villagePath, bytes);
    const changedManifest = JSON.parse(manifest);
    changedManifest.datasets.villages.sha256 = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(manifestPath, JSON.stringify(changedManifest));
    result = run();
    assert.notEqual(result.status, 0, 'Invalid dataset must fail even with a matching hash');
    assert.match(result.stderr, /public data/i);
    reset();
  }
  fs.writeFileSync(path.join(scratch, 'unapproved.json'), '{}');
  result = run();
  assert.notEqual(result.status, 0, 'Unexpected assets must fail');
  assert.match(result.stderr, /file set/i);
  fs.unlinkSync(path.join(scratch, 'unapproved.json'));
  fs.unlinkSync(path.join(scratch, 'coverage.json'));
  assert.notEqual(run().status, 0, 'Missing approved assets must fail');
  console.log('PASS: public-only data validation; changed bytes, extra fields, duplicates, invalid types, extra/missing assets rejected.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
