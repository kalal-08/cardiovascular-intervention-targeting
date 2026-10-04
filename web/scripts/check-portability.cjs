const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const absolutePath = /\b[a-z]:[\\/]+|\/(?:Users|home|tmp)\//gi;
assert(absolutePath.test(String.fromCharCode(67, 58, 92) + 'Users/example'));
absolutePath.lastIndex = 0;
assert(!absolutePath.test('reports/example.png'));

// An exact release manifest includes docs outside web; dependencies/build caches do not.
const files = process.argv[2]
  ? JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8')).files.map(file => file.path)
  : fs.readdirSync(path.join(root, 'web'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.parentPath.split(path.sep)
      .some(part => ['node_modules', '.wrangler', 'dist', 'dist-spikes'].includes(part)))
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)))
    .filter(file => !file.endsWith('README.md'));

const failures = [];
for (const file of files) {
  const resolved = path.resolve(root, file);
  assert(resolved.startsWith(root + path.sep), `Outside repository: ${file}`);
  const bytes = fs.readFileSync(resolved);
  if (bytes.includes(0)) continue; // Binary metadata is inspected separately before release.
  bytes.toString('utf8').split(/\r?\n/).forEach((line, index) => {
    absolutePath.lastIndex = 0;
    if (absolutePath.test(line)) failures.push(`${file}:${index + 1}`);
  });
}
assert.deepEqual(failures, [], `Machine-dependent path occurrences: ${failures.join(', ')}`);
console.log(`Portable text-path check PASS: ${files.length} files; binary metadata requires separate audit.`);
