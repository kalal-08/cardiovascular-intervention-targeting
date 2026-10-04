import assert from 'node:assert/strict';
import { DEFAULTS, resolveRoute } from '../src/contract.ts';

assert.equal(resolveRoute('/'), '/overview');
for (const route of ['/overview', '/risk-vs-benefit', '/hte-validation', '/rollout', '/robustness']) {
  assert.equal(resolveRoute(route), route);
}
assert.equal(resolveRoute('/unknown'), null);
assert.equal(resolveRoute('/robustness-extra'), null);
assert.deepEqual(DEFAULTS['/risk-vs-benefit'], { signal: 'grf' });
assert.deepEqual(DEFAULTS['/rollout'], { policy: 'simple', k: 64 });
assert.deepEqual(DEFAULTS['/robustness'], {
  policy: 'simple', k: 64, dimension: 'age', sort: 'focus', direction: 'asc',
});
console.log('PASS: five exact routes, root resolution, unknown routes and canonical defaults.');
