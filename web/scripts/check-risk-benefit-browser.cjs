const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const rows = JSON.parse(readFileSync('public/data/villages.json')).rows;
const output = process.env.SAVE_REVIEW === '1'
  ? resolve('../reports/figures/web/phase12c6_page2_qa_20261002')
  : resolve('.wrangler/qa/page2');
mkdirSync(output, { recursive: true });
const labels = { grf: 'GRF', simple: 'Simple HTE' };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.url().includes('/data/')) requests.push(request.url()); });
    await page.goto(base + '/risk-vs-benefit');
    await page.locator('.risk-benefit').waitFor();
    assert.equal(await page.locator('.risk-benefit').count(), 1, 'Page-2 body must replace placeholder');
    await page.locator('.risk-kpis').waitFor();
    const chart = page.locator('[data-chart="risk-benefit"]');
    await chart.locator('svg').waitFor();
    const instance = await chart.getAttribute('_echarts_instance_');
    const fixed = await page.locator('.risk-kpis, .risk-agreement, .risk-insights, .risk-details').allTextContents();
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= 1080), 'Default desktop composition fits reference height');
    assert.deepEqual(await page.locator('.risk-kpis dd').allTextContents(), ['127', '13.07%–23.31%', '1.399–2.823 pp', '1.147–3.277 pp']);
    const riskValueStyle = await page.locator('.risk-range').evaluate(value => {
      const style = getComputedStyle(value);
      return { color: style.color, stroke: style.webkitTextStrokeWidth, fontSize: parseFloat(style.fontSize) };
    });
    assert.equal(riskValueStyle.color, 'rgb(242, 140, 0)', 'User-authorized exact Power BI orange for KPI text');
    assert.equal(await page.locator('.risk-kpis .policy-symbol').count(), 0, 'No extra dot beside the baseline-risk KPI');
    assert.equal(riskValueStyle.stroke, '0px', 'No dark glyph outline');
    assert(riskValueStyle.fontSize >= 24);
    assert.deepEqual(await page.locator('.risk-agreement tbody td').allTextContents(), ['0.4649', '0.4305', '0.3349']);
    assert(await page.locator('.risk-insights li, .risk-details li').evaluateAll(items => items.every(item =>
      getComputedStyle(item, '::marker').color === 'rgb(83, 98, 124)'
    )), 'Decorative text bullets use the neutral secondary-text color, not a policy color');
    async function verify(signal) {
      assert.equal(await page.getByRole('button', { name: labels[signal], exact: true }).getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await chart.getAttribute('_echarts_instance_'), instance, 'Signal does not recreate chart');
      const color = signal === 'grf' ? '#0B2E83' : '#0798A5';
      const points = chart.locator(`svg path[fill="${color}"]`);
      assert.equal(await points.count(), 127, 'Every village represented exactly once');
      const coordinates = await points.evaluateAll(points => points.map(point => { const r = point.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
      const box = await chart.boundingBox();
      const svgWidth = Number(await chart.locator('svg').getAttribute('width'));
      rows.forEach((row, i) => {
        const x = box.x + 84 + (row.baseline_risk - 12) / 12 * (svgWidth - 108);
        const y = box.y + 20 + (3.5 - row[`${signal}_predicted_benefit`]) / 2.5 * (box.height - 90);
        assert(Math.abs(coordinates[i][0] - x) < 1 && Math.abs(coordinates[i][1] - y) < 1, `Actual source coordinate: ${row.village_id}/${signal}: ${JSON.stringify(coordinates[i])}, expected ${x}/${y}`);
      });
      const svg = await chart.locator('svg').textContent();
      for (const axis of ['12%', '24%', '1.0', '3.5']) assert(svg.includes(axis), axis);
      await page.getByText('Explore village values', { exact: true }).click();
      const detail = page.getByRole('table', { name: 'Selected village signal values' });
      assert.equal(await detail.locator('tbody tr').count(), 127);
      assert.deepEqual(await detail.locator('thead th').allTextContents(), ['Village ID', 'Baseline risk (%)', `${labels[signal]} benefit (pp)`]);
      assert.deepEqual(await detail.locator('tbody tr').allTextContents(), rows.map(row => `${row.village_id}${row.baseline_risk.toFixed(2)}%${row[`${signal}_predicted_benefit`].toFixed(3)} pp`));
      const scroll = page.getByRole('region', { name: 'All 127 village signal values' });
      await scroll.focus(); await page.keyboard.press('End');
      await page.waitForFunction(() => { const node = document.querySelector('.risk-value-scroll'); return node.scrollTop >= node.scrollHeight - node.clientHeight - 1; });
      assert.equal(await detail.locator('tbody th').last().innerText(), '127');
      await page.getByText('Explore village values', { exact: true }).click();
      await points.first().hover();
      await page.waitForTimeout(100);
      const text = await chart.locator('svg').textContent();
      assert(text.includes(`Village ${rows[0].village_id}`));
      assert(text.includes(`Baseline predicted risk: ${rows[0].baseline_risk.toFixed(2)}%`));
      assert(text.includes(`${labels[signal]} benefit: ${rows[0][`${signal}_predicted_benefit`].toFixed(3)} pp`));
      assert(!text.includes(`${labels[signal === 'grf' ? 'simple' : 'grf']} benefit:`));
      await page.mouse.move(0, 0);
      assert.deepEqual(await page.locator('.risk-kpis, .risk-agreement, .risk-insights, .risk-details').allTextContents(), fixed);
    }
    await verify('grf');
    const initialRequests = requests.length;
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(base + '/risk-vs-benefit?signal=simple');
    await verify('simple');
    assert.equal(requests.length, initialRequests, 'Signal does not refetch data');
    await page.goBack(); await verify('grf');
    await page.goForward(); await verify('simple');
    await page.reload(); await page.locator('.risk-kpis').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Simple HTE', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('link', { name: 'Rollout', exact: true }).click();
    assert.equal(new URL(page.url()).search, '');
    await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
    assert.equal(new URL(page.url()).search, '?signal=simple');
    await page.getByRole('link', { name: 'Robustness', exact: true }).click();
    assert.equal(new URL(page.url()).search, '');
    await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
    assert.equal(new URL(page.url()).search, '?signal=simple');
    for (const [route, label, query] of [
      ['/rollout', 'Rollout', '?policy=grf&k=95'],
      ['/robustness', 'Robustness', '?policy=baseline_risk&k=32&dimension=occupation&sort=participants&direction=desc'],
    ]) {
      await page.goto(base + route + query);
      assert.equal(new URL(page.url()).search, query);
      await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
      await page.locator('.risk-kpis').waitFor();
      await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
      await page.getByRole('button', { name: 'GRF', exact: true }).click();
      await page.getByRole('link', { name: label, exact: true }).click();
      assert.equal(new URL(page.url()).search, query, 'Page-2 selection preserves remembered nondefault page state');
    }
    await page.goto(base + '/risk-vs-benefit'); await page.locator('.risk-kpis').waitFor();
    const retained = await chart.getAttribute('_echarts_instance_');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await chart.getAttribute('_echarts_instance_'), retained);
    assert.equal(await page.getByRole('button', { name: 'GRF', exact: true }).getAttribute('aria-pressed'), 'true');
    for (const query of ['signal=bad', 'signal=grf&signal=simple']) {
      await page.goto(base + '/risk-vs-benefit?' + query);
      await page.getByText('Invalid state reset to defaults: signal.').waitFor();
      assert.equal(new URL(page.url()).search, '');
    }
    await page.goto(base + '/risk-vs-benefit?signal=simple&unknown=1'); await page.locator('.risk-kpis').waitFor();
    assert.equal(new URL(page.url()).search, '?signal=simple');
    await page.goto(base + '/risk-vs-benefit'); await page.locator('.risk-kpis').waitFor();
    const times = [];
    for (let i = 0; i < 10; i++) {
      const signal = i % 2 === 0 ? 'simple' : 'grf';
      const start = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: labels[signal], exact: true }).click();
      await chart.locator(`svg path[fill="${signal === 'grf' ? '#0B2E83' : '#0798A5'}"]`).first().waitFor();
      times.push(await page.evaluate(() => performance.now()) - start);
    }
    for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow: ${width}`);
      assert(await page.locator('.risk-benefit').evaluate(root => [...root.querySelectorAll('.kpi, th, td, li, .risk-fixed-note')].every(node => node.scrollWidth <= node.clientWidth + 1)), `Text clipping: ${width}`);
      assert(await chart.evaluate(host => {
        const box = host.getBoundingClientRect();
        const texts = [...host.querySelectorAll('svg text')];
        if (!texts.every(node => { const r = node.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1; })) return false;
        const ticks = texts.filter(node => /^\d+%$/.test(node.textContent)).map(node => node.getBoundingClientRect());
        return ticks.every((a, i) => ticks.every((b, j) => i === j || a.right <= b.left || b.right <= a.left));
      }), `Chart labels clipped/overlapping: ${width}`);
      await page.screenshot({ path: resolve(output, `risk-benefit-grf-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    await page.screenshot({ path: resolve(output, 'risk-benefit-simple-1920.png'), fullPage: true });
    await page.setViewportSize({ width: 960, height: 540 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Enlarged-text overflow');
    await page.screenshot({ path: resolve(output, 'risk-benefit-enlarged-text.png'), fullPage: true });
    assert.deepEqual(errors, []);

    const moving = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference' });
    await moving.goto(base + '/risk-vs-benefit');
    const movingChart = moving.locator('[data-chart="risk-benefit"]');
    await movingChart.locator('svg path[fill="#0B2E83"]').first().waitFor();
    const movingInstance = await movingChart.getAttribute('_echarts_instance_');
    const fixedDuringMotion = await moving.locator('.risk-kpis, .risk-agreement').allTextContents();
    const motionBox = await movingChart.boundingBox();
    const targetY = signal => motionBox.y + 20 + (3.5 - rows[0][`${signal}_predicted_benefit`]) / 2.5 * (motionBox.height - 90);
    for (const signal of ['simple', 'grf']) {
      const frames = await moving.evaluate(label => new Promise(resolve => {
        const host = document.querySelector('[data-chart="risk-benefit"]');
        const snapshot = () => {
          const points = [...host.querySelectorAll('svg path[fill]:not([fill="none"])')];
          const point = points[0].getBoundingClientRect();
          return { count: points.length, x: point.x + point.width / 2, y: point.y + point.height / 2 };
        };
        const frames = [snapshot()], start = performance.now();
        [...document.querySelectorAll('.risk-signals button')].find(button => button.textContent === label).click();
        function sample() {
          frames.push(snapshot());
          if (performance.now() - start >= 300) resolve(frames); else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }), labels[signal]);
      const end = targetY(signal), start = frames[0].y;
      assert(frames.some(frame => Math.abs(frame.y - start) > 1 && Math.abs(frame.y - end) > 1), 'Visible intermediate point positions, not an entrance effect');
      assert(Math.abs(frames.at(-1).y - end) < 1, 'Motion ends at the exact selected source coordinate');
      assert(frames.every(frame => frame.count === 127 && Math.abs(frame.x - frames[0].x) < 1), 'Motion preserves every village and fixed X coordinates');
      assert.equal(await movingChart.getAttribute('_echarts_instance_'), movingInstance);
      assert.deepEqual(await moving.locator('.risk-kpis, .risk-agreement').allTextContents(), fixedDuringMotion);
    }
    await moving.evaluate(() => {
      document.querySelectorAll('.risk-signals button')[1].click();
      requestAnimationFrame(() => document.querySelectorAll('.risk-signals button')[0].click());
    });
    await moving.waitForTimeout(300);
    const firstY = () => movingChart.locator('svg path[fill="#0B2E83"]').first().evaluate(point => { const r = point.getBoundingClientRect(); return r.y + r.height / 2; });
    assert(Math.abs(await firstY() - targetY('grf')) < 1, 'Rapid reversal settles on the latest selection');
    await moving.emulateMedia({ reducedMotion: 'reduce' });
    await moving.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    await moving.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const reducedPoint = await movingChart.locator('svg path[fill="#0798A5"]').first().boundingBox();
    assert(Math.abs(reducedPoint.y + reducedPoint.height / 2 - targetY('simple')) < 1, 'Reduced motion updates immediately');
    assert.equal(await movingChart.getAttribute('_echarts_instance_'), movingInstance);
    await moving.close();

    // Hash-matched intercepted inputs exercise production loading without editing frozen files.
    async function mocked(documents) {
      const context = await browser.newPage();
      const manifest = JSON.parse(readFileSync('public/data/manifest.json'));
      for (const [name, document] of Object.entries(documents)) {
        const body = JSON.stringify(document);
        if (name === 'schemas') manifest.schemas.sha256 = createHash('sha256').update(body).digest('hex');
        else manifest.datasets[name].sha256 = createHash('sha256').update(body).digest('hex');
        await context.route(`**/data/${name}.json`, route => route.fulfill({ contentType: 'application/json', body }));
      }
      await context.route('**/data/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }));
      return context;
    }
    const changed = JSON.parse(readFileSync('public/data/villages.json'));
    changed.rows[0].baseline_risk = 24;
    changed.rows[0].simple_predicted_benefit = 3.4;
    const bound = await mocked({ villages: changed });
    await bound.goto(base + '/risk-vs-benefit?signal=simple'); await bound.locator('.risk-kpis').waitFor();
    assert.equal(await bound.locator('.risk-kpis dd').nth(1).innerText(), '13.07%–24.00%');
    assert.equal(await bound.locator('.risk-kpis dd').nth(3).innerText(), '1.147–3.400 pp');
    await bound.getByText('Explore village values', { exact: true }).click();
    assert.equal(await bound.getByRole('table', { name: 'Selected village signal values' }).locator('tbody tr').first().innerText(), '1\t24.00%\t3.400 pp');
    await bound.close();
    const broken = await browser.newPage();
    await broken.route('**/data/villages.json', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await broken.goto(base + '/risk-vs-benefit');
    await broken.getByRole('alert').filter({ hasText: 'Unable to load frozen village signals.' }).waitFor();
    assert.equal(await broken.locator('.risk-kpis').count(), 0); await broken.close();
    const incomplete = JSON.parse(readFileSync('public/data/villages.json'));
    incomplete.rows.pop();
    const missing = await mocked({ villages: incomplete });
    await missing.goto(base + '/risk-vs-benefit'); await missing.getByRole('alert').waitFor();
    assert.equal(await missing.locator('[data-chart]').count(), 0); await missing.close();
    const validation = JSON.parse(readFileSync('public/data/validation.json'));
    validation.rows.find(row => row.metric === 'village_signal_spearman').estimate = null;
    const missingCorrelation = await mocked({ validation });
    await missingCorrelation.goto(base + '/risk-vs-benefit'); await missingCorrelation.getByRole('alert').waitFor();
    assert.equal(await missingCorrelation.locator('.risk-agreement').count(), 0); await missingCorrelation.close();
    const schemas = JSON.parse(readFileSync('public/data/schemas.json'));
    schemas.$defs.villages.properties.rows.minItems = 0;
    const empty = await mocked({ schemas, villages: { schema_name: 'villages', schema_version: '1.0.0', rows: [] } });
    await empty.goto(base + '/risk-vs-benefit');
    await empty.getByRole('status').filter({ hasText: 'No frozen village signals available.' }).waitFor();
    assert.equal(await empty.locator('[data-chart]').count(), 0); await empty.close();
    const loading = await browser.newPage();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await loading.route('**/data/villages.json', async route => { await hold; await route.continue(); });
    await loading.goto(base + '/risk-vs-benefit');
    await loading.getByRole('status').filter({ hasText: 'Loading frozen village signals…' }).waitFor();
    assert.equal(await loading.locator('.risk-kpis').count(), 0);
    release(); await loading.locator('.risk-kpis').waitFor(); await loading.close();
    console.log(JSON.stringify({ status: 'PASS', points: 127, signals: 2, widths: 4, sourceCoordinates: true, selectedOnlyDetail: true, frozenScope: true, urlHistory: true, neutralBullets: true, animatedUpdates: true, reducedMotion: true, rapidReversal: true, maxMeasuredMs: Math.max(...times), samplesMs: times }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
