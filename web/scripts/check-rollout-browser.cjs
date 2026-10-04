const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const anchors = JSON.parse(readFileSync('public/data/anchors.json')).rows;
const curves = JSON.parse(readFileSync('public/data/rollout.json')).rows;
const output = process.env.SAVE_REVIEW === '1' ? resolve('../reports/figures/web/phase12c8_page4_polish_20261003') : resolve('.wrangler/qa/page4');
const policies = { grf: 'GRF', simple: 'Simple HTE', baseline_risk: 'Baseline Risk' };
mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 990 }, reducedMotion: 'reduce' });
    const errors = [], requests = [], timing = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (r.url().includes('/data/')) requests.push(r.url()); });
    await page.goto(base + '/rollout');
    await page.locator('.rollout').waitFor();
    assert.equal(await page.locator('.rollout').count(), 1, 'Page-4 production body must replace the placeholder');
    await page.locator('.rollout-kpis').waitFor();
    const charts = page.locator('.rollout [data-chart]');
    await charts.first().locator('svg').waitFor(); await charts.last().locator('svg').waitFor();
    let instances = await charts.evaluateAll(nodes => nodes.map(n => n.getAttribute('_echarts_instance_')));
    const matrix = await page.getByRole('table', { name: 'Fixed-capacity rollout evidence' }).locator('tbody').innerText();
    const initialRequests = requests.length;
    async function verify(policy, k) {
      const row = anchors.find(r => r.policy === policy && r.capacity_villages === k);
      assert.equal(await page.getByRole('button', { name: policies[policy], exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('button', { name: `${k} villages`, exact: true }).getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.locator('.rollout-kpis dd').allTextContents(), [String(k), row.n_selected_randomized.toLocaleString('en-US'), `${row.point_population_rollout_value.toFixed(4)} pp`, `${row.point_gain_vs_random > 0 ? '+' : ''}${row.point_gain_vs_random.toFixed(4)} pp`]);
      assert((await page.locator('.rollout-kpis').innerText()).includes(row.population_value_ci_lower.toFixed(4)));
      assert((await page.locator('.rollout-kpis').innerText()).includes(row.gain_ci_upper.toFixed(4)));
      assert.equal(await page.getByRole('table', { name: 'Fixed-capacity rollout evidence' }).locator('tbody').innerText(), matrix, 'Matrix values are fixed');
      assert.equal(await page.locator('.rollout-matrix thead [aria-current="true"]').innerText(), `K = ${k}${k === 127 ? ' Endpoint' : ''} Selected`);
      assert((await page.locator('.rollout-coverage').innerText()).includes(`${row.n_selected_randomized.toLocaleString('en-US')} of 4,533`));
      assert((await page.locator('.rollout-coverage').innerText()).includes(`${row.n_selected_evaluation.toLocaleString('en-US')} of 4,508`));
      assert.deepEqual(await charts.evaluateAll(nodes => nodes.map(n => n.getAttribute('_echarts_instance_'))), instances, 'Selectors retain chart instances');
      for (const chart of await charts.all()) {
        assert((await chart.locator('svg').textContent()).includes(`K=${k}`));
        assert((await chart.locator('svg').textContent()).includes('All policies converge'), 'Endpoint reconciliation remains visibly annotated');
        for (const color of ['#0B2E83', '#0798A5', '#F28C00']) assert(await chart.locator(`svg path[stroke="${color}"][fill="none"]`).count(), 'Every policy line remains visible');
      }
    }
    await verify('simple', 64);
    for (const chart of await charts.all()) assert((await chart.boundingBox()).height >= 300, 'Page 4 preserves readable chart height instead of forcing one-screen fitting');
    for (const chart of await charts.all()) {
      const labels = await chart.locator('svg text').allTextContents();
      for (const k of ['0', '13', '32', '64', '95', '127']) assert(labels.includes(k), `Rendered capacity tick ${k}`);
      assert.equal(await chart.locator('svg path[stroke="#E8EDF4"]').count(), 6, 'Six faint vertical capacity gridlines are rendered');
    }
    for (const legend of await page.locator('.rollout-marker-legend').all()) {
      const text = await legend.innerText();
      for (const label of ['Selected anchor', 'Prespecified anchors', 'Selected capacity']) assert(text.includes(label));
    }
    await page.screenshot({ path: resolve(output, 'page4-default.png'), fullPage: true });
    for (const policy of Object.keys(policies)) {
      await page.getByRole('button', { name: policies[policy], exact: true }).click();
      for (const k of [13, 32, 64, 95, 127]) {
        const start = performance.now(); await page.getByRole('button', { name: `${k} villages`, exact: true }).click();
        await verify(policy, k); timing.push(performance.now() - start);
      }
    }
    assert.equal(requests.length, initialRequests, 'Selectors do not refetch frozen datasets');
    await page.screenshot({ path: resolve(output, 'page4-full-capacity.png'), fullPage: true });
    await page.getByRole('button', { name: '32 villages', exact: true }).focus(); await page.keyboard.press('Enter');
    await verify('baseline_risk', 32); await page.goBack(); await verify('baseline_risk', 127); await page.goForward(); await verify('baseline_risk', 32);
    await page.reload(); await page.locator('.rollout-kpis').waitFor();
    assert((await page.locator('.rollout-kpis dd').allTextContents())[0] === '32');
    await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
    assert.equal(new URL(page.url()).search, '');
    await page.getByRole('link', { name: 'Rollout', exact: true }).click();
    assert.equal(new URL(page.url()).search, '?policy=baseline_risk&k=32');
    await page.goto(base + '/rollout'); await page.locator('.rollout-kpis').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Simple HTE', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: '64 villages', exact: true }).getAttribute('aria-pressed'), 'true');
    // Check actual rendered geometry and pointer detail, not only chart-option arrays.
    for (const [index, kind, domain] of [[0, 'value', [-.2, 2.8]], [1, 'gain', [-.6, .8]]]) {
      const chart = charts.nth(index);
      await chart.scrollIntoViewIfNeeded();
      const box = await chart.boundingBox();
      const field = kind === 'value' ? 'point_population_rollout_value' : 'point_gain_vs_random';
      for (const [policy, color] of Object.entries({ grf: '#0B2E83', simple: '#0798A5', baseline_risk: '#F28C00' })) {
        const d = await chart.locator(`svg path[stroke="${color}"][fill="none"]`).first().getAttribute('d');
        const points = [...d.matchAll(/[ML]([\d.-]+)[ ,]([\d.-]+)/g)].map(m => [+m[1], +m[2]]);
        assert.equal(points.length, 128);
        const source = curves.filter(r => r.policy === policy);
        for (let k = 0; k <= 127; k++) {
          assert(Math.abs(points[k][0] - (points[0][0] + k / 127 * (points[127][0] - points[0][0]))) < .1);
          assert(Math.abs(points[k][1] - (22 + (domain[1] - source[k][field]) / (domain[1] - domain[0]) * (box.height - 76))) < .1);
        }
      }
      const band = await chart.locator('svg path').evaluateAll(nodes => nodes.find(n => n.getAttribute('fill') === '#0798A5' && n.getAttribute('d').length > 1000)?.getAttribute('d'));
      const polygon = [...band.matchAll(/[ML]([\d.-]+)[ ,]([\d.-]+)/g)].map(m => [+m[1], +m[2]]);
      const source = curves.filter(r => r.policy === 'simple');
      const expected = [...source.map(r => [r.capacity_villages, r[`${kind === 'value' ? 'population_value' : 'gain'}_ci_lower`]]), ...[...source].reverse().map(r => [r.capacity_villages, r[`${kind === 'value' ? 'population_value' : 'gain'}_ci_upper`]])]
        .map(([k, value]) => [polygon[0][0] + k / 127 * (Math.max(...polygon.map(p => p[0])) - polygon[0][0]), 22 + (domain[1] - value) / (domain[1] - domain[0]) * (box.height - 76)]);
      // SVG may omit coincident full-capacity/closing vertices; they have identical geometry.
      const simplify = points => points.filter((p, i) => i === 0 || Math.abs(p[0] - points[i - 1][0]) + Math.abs(p[1] - points[i - 1][1]) > .01);
      const actualPoints = simplify(polygon), expectedPoints = simplify(expected);
      for (const points of [actualPoints, expectedPoints]) if (Math.abs(points[0][0] - points.at(-1)[0]) + Math.abs(points[0][1] - points.at(-1)[1]) < .01) points.pop();
      assert.equal(actualPoints.length, expectedPoints.length);
      actualPoints.forEach((point, i) => assert(Math.abs(point[0] - expectedPoints[i][0]) + Math.abs(point[1] - expectedPoints[i][1]) < .15));
      for (const k of [0, 64, 127]) {
        await chart.scrollIntoViewIfNeeded();
        const hoverBox = await chart.boundingBox();
        const selectedPoint = curves.find(r => r.policy === 'simple' && r.capacity_villages === k);
        const pointerX = hoverBox.x + 62 + k / 127 * (Math.floor(hoverBox.width) - 85);
        const pointerY = hoverBox.y + 22 + (domain[1] - selectedPoint[field]) / (domain[1] - domain[0]) * (hoverBox.height - 76);
        await page.mouse.move(10, 10);
        await page.mouse.move(pointerX, pointerY);
        const tooltip = page.getByRole('tooltip').filter({ visible: true });
        await tooltip.filter({ hasText: `Capacity K=${k}` }).waitFor();
        for (const policy of Object.keys(policies)) {
          const source = curves.find(r => r.policy === policy && r.capacity_villages === k);
          const row = tooltip.locator('tbody tr').filter({ hasText: policies[policy] });
          assert((await row.innerText()).includes(source.n_selected_randomized.toLocaleString('en-US')));
          assert((await row.innerText()).replaceAll('−', '-').includes(source[field].toFixed(4)), `${kind} ${policy} K=${k} source tooltip value`);
          for (const suffix of ['lower', 'upper']) assert((await row.innerText()).replaceAll('−', '-').includes(source[`${kind === 'value' ? 'population_value' : 'gain'}_ci_${suffix}`].toFixed(4)));
        }
        assert.equal((await tooltip.innerText()).includes('Random expectation:'), kind === 'value');
        const tipBox = await tooltip.boundingBox();
        assert(tipBox.x >= 0 && tipBox.y >= 0 && tipBox.x + tipBox.width <= 1920 && tipBox.y + tipBox.height <= 990);
        assert(!(pointerX >= tipBox.x && pointerX <= tipBox.x + tipBox.width && pointerY >= tipBox.y && pointerY <= tipBox.y + tipBox.height), 'Tooltip does not cover the inspected marker');
        if (k === 64) assert(tipBox.x > pointerX && tipBox.y + tipBox.height < pointerY, 'Middle-capacity detail prefers above and right of the inspected point');
        assert.equal(await page.locator('.rollout-kpis dd').first().innerText(), '64');
        if (k === 64) {
          await page.locator('.rollout-chart-panel').nth(index).screenshot({ path: resolve(output, `page4-${kind}-tooltip.png`) });
          await page.mouse.move(tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2);
          await tooltip.waitFor();
        }
        await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'hidden' });
      }
    }
    await page.mouse.move(10, 10);
    await page.getByText('Explore chart values', { exact: true }).click();
    const inspect = page.getByRole('slider', { name: 'Inspect chart capacity' });
    await inspect.focus(); await page.keyboard.press('Home');
    assert((await page.locator('.rollout-inspection').innerText()).includes('K=0'));
    await page.keyboard.press('End'); assert((await page.locator('.rollout-inspection').innerText()).includes('K=127'));
    assert.equal(await page.locator('.rollout-inspection tbody tr').count(), 3);
    for (let k = 0; k <= 127; k++) {
      await inspect.fill(String(k));
      for (const [i, policy] of Object.keys(policies).entries()) {
        const source = curves.find(r => r.policy === policy && r.capacity_villages === k);
        assert((await page.locator('.rollout-inspection tbody tr').nth(i).innerText()).replaceAll('−', '-').includes(source.point_population_rollout_value.toFixed(4)));
      }
    }
    assert.equal(await page.locator('.rollout-kpis dd').first().innerText(), '64', 'Inspection does not change selected capacity');
    assert.equal(new URL(page.url()).search, '');
    const alignment = await page.locator('.rollout-inspection table').evaluate(table => [...table.rows].map(row => [...row.cells].map(cell => ({ align: getComputedStyle(cell).textAlign, separator: getComputedStyle(cell).borderRightWidth }))));
    for (const row of alignment) row.forEach((cell, i) => { assert.equal(cell.align, i === 0 ? 'left' : 'right'); if (i < row.length - 1) assert.equal(cell.separator, '1px'); });
    await page.locator('.rollout-inspection').screenshot({ path: resolve(output, 'page4-inspection.png') });
    await page.getByText('Explore chart values', { exact: true }).click();
    for (const [width, height] of [[1920, 990], [1366, 768], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-chart]')].every(n => Math.abs(Number(n.querySelector('svg')?.getAttribute('width')) - n.getBoundingClientRect().width) < 2));
      await page.mouse.move(width - 4, 4);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: resolve(output, `page4-${width}.png`), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page horizontal overflow at ${width}`);
      assert((await charts.first().boundingBox()).width > 200);
      for (const chart of await charts.all()) {
        await chart.scrollIntoViewIfNeeded();
        const box = await chart.boundingBox();
        await page.mouse.move(box.x + 60 + 64 / 127 * (Math.floor(box.width) - 82), box.y + box.height / 2);
        const tooltip = page.getByRole('tooltip').filter({ visible: true });
        await tooltip.waitFor();
        const tip = await tooltip.boundingBox();
        assert(tip.x >= 0 && tip.y >= 0 && tip.x + tip.width <= width && tip.y + tip.height <= height, `Tooltip viewport clearance at ${width}`);
        assert.equal(await page.getByRole('tooltip').filter({ visible: true }).count(), 1);
        await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'hidden' });
      }
    }
    await page.setViewportSize({ width: 1920, height: 990 });
    await page.goto(base + '/rollout?policy=bogus&k=64&k=13'); await page.getByRole('status').filter({ hasText: 'Invalid state' }).waitFor();
    await page.locator('.rollout-kpis').waitFor(); assert.equal(new URL(page.url()).search, '');
    assert.deepEqual(errors, []);
    async function mocked(replacements) {
      const test = await browser.newPage();
      const manifest = JSON.parse(readFileSync('public/data/manifest.json'));
      for (const [name, document] of Object.entries(replacements)) {
        const body = JSON.stringify(document), hash = createHash('sha256').update(body).digest('hex');
        if (name === 'schemas') manifest.schemas.sha256 = hash;
        else manifest.datasets[name].sha256 = hash;
        await test.route(`**/data/${name}.json`, route => route.fulfill({ contentType: 'application/json', body }));
      }
      await test.route('**/data/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }));
      return test;
    }
    const changed = JSON.parse(readFileSync('public/data/anchors.json'));
    changed.rows.find(r => r.policy === 'simple' && r.capacity_villages === 64).n_selected_randomized = 2301;
    const bound = await mocked({ anchors: changed });
    await bound.goto(base + '/rollout'); await bound.locator('.rollout-kpis').waitFor();
    assert.equal(await bound.locator('.rollout-kpis dd').nth(1).innerText(), '2,301'); await bound.close();
    const broken = await browser.newPage();
    await broken.route('**/data/rollout.json', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await broken.goto(base + '/rollout'); await broken.getByRole('alert').waitFor();
    assert.equal(await broken.locator('[data-chart]').count(), 0); await broken.close();
    const schemas = JSON.parse(readFileSync('public/data/schemas.json'));
    schemas.$defs.rollout.properties.rows.minItems = 0;
    const empty = await mocked({ schemas, rollout: { schema_name: 'rollout', schema_version: '1.0.0', rows: [] } });
    await empty.goto(base + '/rollout'); await empty.getByRole('status').filter({ hasText: 'No frozen rollout evidence available.' }).waitFor(); await empty.close();
    const loading = await browser.newPage(); let release;
    const hold = new Promise(resolve => { release = resolve; });
    await loading.route('**/data/rollout.json', async route => { await hold; await route.continue(); });
    await loading.goto(base + '/rollout'); await loading.getByRole('status').filter({ hasText: 'Loading frozen rollout evidence…' }).waitFor();
    release(); await loading.locator('.rollout-kpis').waitFor(); await loading.close();
    await page.goto(base + '/rollout'); await page.locator('.rollout-kpis').waitFor();
    await charts.last().locator('svg').waitFor();
    instances = await charts.evaluateAll(nodes => nodes.map(n => n.getAttribute('_echarts_instance_')));
    assert(await page.locator('.policy-name-baseline_risk').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).color === 'rgb(242, 140, 0)')));
    const updateTimes = [];
    for (const k of [13, 32, 64, 95, 127]) updateTimes.push(await page.evaluate(k => new Promise(resolve => {
      const start = performance.now();
      document.querySelector(`button[aria-label="${k} villages"]`).click();
      const inspect = () => {
        if (document.querySelector('.rollout-kpis dd').textContent === String(k)) requestAnimationFrame(() => resolve(performance.now() - start));
        else requestAnimationFrame(inspect);
      }; requestAnimationFrame(inspect);
    }), k));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'GRF', exact: true }).click(); await verify('grf', 127);
    await page.setViewportSize({ width: 960, height: 495 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await page.screenshot({ path: resolve(output, 'page4-enlarged-text.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Enlarged text reflows without page overflow');
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await touch.goto(base + '/rollout'); await touch.locator('.rollout-kpis').waitFor();
    await touch.getByRole('button', { name: 'GRF', exact: true }).tap();
    await touch.getByRole('button', { name: '13 villages', exact: true }).tap();
    assert.equal(await touch.locator('.rollout-kpis dd').first().innerText(), '13');
    await touch.getByText('Explore chart values', { exact: true }).tap();
    await touch.getByRole('slider', { name: 'Inspect chart capacity' }).fill('127');
    assert.equal(await touch.locator('.rollout-inspection tbody tr').count(), 3); await touch.close();
    console.log(JSON.stringify({ status: 'PASS', states: 15, fixedMatrix: true, svgSourceCoordinates: true, pointwiseBands: true, tooltips: 6, upperRightPlacement: true, readableChartHeight: true, capacityTicks: true, completeLegends: true, alignedInspectionGrid: true, instances: true, scopeHistory: true, inspectionCapacities: 128, widths: 4, enlargedText: true, touch: true, safeDataStates: true, renderedColors: true, visibleUpdateMs: updateTimes, testLoopMaxMs: Math.max(...timing), errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
