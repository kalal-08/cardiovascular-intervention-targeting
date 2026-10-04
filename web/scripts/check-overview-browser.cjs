const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4175';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const source = JSON.parse(readFileSync('public/data/overview.json')).rows[0];
const output = resolve('.wrangler/qa');
mkdirSync(output, { recursive: true });
const counts = number => number.toLocaleString('en-US');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [], failed = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => failed.push(request.url()));
    await page.goto(base + '/overview');
    await page.locator('.overview-kpis').waitFor({ timeout: 10000 });
    const expected = [source.randomized_participants, source.evaluation_participants, source.missing_primary_outcome, source.villages];
    assert.deepEqual(await page.locator('.overview-kpis dd').allTextContents(), expected.map(counts));
    assert.equal(await page.locator('main select, main input, main button').count(), 0, 'No analytical selectors or sorting');
    const allocation = page.getByRole('table', { name: 'Randomized allocation' });
    assert.deepEqual(await allocation.locator('tbody tr').allTextContents(), [
      `Intervention${counts(source.intervention_participants)}${source.intervention_villages}`,
      `Control${counts(source.control_participants)}${source.control_villages}`,
      `Total${counts(source.randomized_participants)}${source.villages}`,
    ]);
    const completeness = page.getByRole('table', { name: 'Primary follow-up completeness' });
    assert.deepEqual(await completeness.locator('tbody tr').allTextContents(), [
      `Observed${counts(source.evaluation_participants)}${(source.evaluation_participants / source.randomized_participants * 100).toFixed(1)}%`,
      `Missing${counts(source.missing_primary_outcome)}${(source.missing_primary_outcome / source.randomized_participants * 100).toFixed(1)}%`,
    ]);
    assert.equal(await page.locator('.effect-value').innerText(), '-1.880 pp');
    assert.equal(await page.locator('.ci-summary').innerText(), '95% CI: −2.564 to −1.196');
    const chart = page.getByRole('img', { name: 'Adjusted Effect and 95% CI', exact: true });
    await chart.locator('svg').waitFor();
    await chart.locator('svg path[fill="#0798A5"]').hover();
    await page.waitForTimeout(100);
    assert((await chart.locator('svg').textContent()).includes('Estimate: -1.880 pp'), 'Source-equivalent hover detail');
    await page.mouse.move(0, 0);
    const description = await page.locator('[id="' + await chart.getAttribute('aria-describedby') + '"]').innerText();
    assert(description.includes('-1.880 pp') && description.includes('-2.564 to -1.196'));
    for (const text of ['Available-primary-outcome analysis', 'Do not describe as unqualified full ITT', 'not observed cardiovascular events', 'Not an individual clinical recommendation'])
      assert((await page.locator('main').innerText()).includes(text));
    const svgText = await chart.locator('svg').textContent();
    for (const value of ['−2.564', '−1.880', '−1.196', '-3', '0', '1']) assert(svgText.includes(value), value);
    const before = await chart.getAttribute('_echarts_instance_');
    const geometry = await page.locator('.overview-kpis .kpi, .overview-middle > .panel').evaluateAll(elements => elements.map(element => ({ y: element.getBoundingClientRect().y, height: element.getBoundingClientRect().height })));
    assert(geometry.slice(0, 4).every(box => Math.abs(box.height - geometry[0].height) < 1 && Math.abs(box.y - geometry[0].y) < 1), 'Equal aligned KPIs in the shared desktop fit layout');
    assert(geometry.slice(4).every(box => Math.abs(box.height - geometry[4].height) < 1 && Math.abs(box.y - geometry[4].y) < 1), 'Equal aligned middle panels');
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'Default desktop fit without clipping');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await chart.getAttribute('_echarts_instance_'), before, 'Resize/motion must not recreate chart');
    for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow: ${width}`);
      assert(await page.locator('.overview').evaluate(root => [...root.querySelectorAll('td, th, li, .kpi')].every(element => element.scrollWidth <= element.clientWidth + 1)), `Clipped text: ${width}`);
      assert(await chart.evaluate(host => {
        const labels = [...host.querySelectorAll('text')].filter(node => /^−\d\.\d{3}$/.test(node.textContent)).map(node => node.getBoundingClientRect());
        return labels.every((a, i) => labels.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
      }), `Overlapping CI labels: ${width}`);
      await page.screenshot({ path: resolve(output, `overview-${width}.png`), fullPage: true });
      if (process.env.SAVE_REVIEW === '1') {
        const review = resolve('../reports/figures/web/phase12c5_page1_qa_20261002');
        mkdirSync(review, { recursive: true });
        await page.screenshot({ path: resolve(review, `overview-${width}.png`), fullPage: true });
        if (width === 1920) await page.locator('.header').screenshot({ path: resolve(review, 'header-1920.png') });
      }
    }
    await page.setViewportSize({ width: 960, height: 540 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% equivalent layout/text reflow');
    assert(await page.locator('.overview').evaluate(root => [...root.querySelectorAll('td, th, li, .kpi, .effect-value')].every(element => element.scrollWidth <= element.clientWidth + 1)), '200% text overflow');
    await page.screenshot({ path: resolve(output, 'overview-zoom-200.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload();
    await page.locator('.overview-kpis').waitFor();
    await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
    await page.getByRole('heading', { name: 'Risk vs Predicted Benefit', exact: true }).waitFor();
    await page.goBack();
    await page.locator('.overview-kpis').waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: 'Risk vs Predicted Benefit', exact: true }).waitFor();
    await page.goto(base + '/overview');
    await page.locator('.overview-kpis').waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').innerText(), 'Skip to content');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'content');
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);

    // Mock a valid, hash-matched response to prove the UI binds values rather than literal strings.
    const bound = await browser.newPage();
    const document = JSON.parse(readFileSync('public/data/overview.json'));
    document.rows[0].randomized_participants = 4534;
    document.rows[0].evaluation_participants = 4509;
    const body = JSON.stringify(document);
    const manifest = JSON.parse(readFileSync('public/data/manifest.json'));
    manifest.datasets.overview.sha256 = createHash('sha256').update(body).digest('hex');
    await bound.route('**/data/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }));
    await bound.route('**/data/overview.json', route => route.fulfill({ contentType: 'application/json', body }));
    await bound.goto(base + '/overview');
    await bound.locator('.overview-kpis').waitFor();
    assert.equal(await bound.locator('.overview-kpis dd').first().innerText(), '4,534');
    assert.equal(await bound.locator('.overview-kpis dd').nth(1).innerText(), '4,509');
    assert.equal(await bound.getByRole('table', { name: 'Randomized allocation' }).locator('tbody tr').last().innerText(), 'Total\t4,534\t127');
    await bound.close();
    const broken = await browser.newPage();
    await broken.route('**/data/overview.json', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await broken.goto(base + '/overview');
    await broken.getByRole('alert').filter({ hasText: 'Unable to load frozen summary' }).waitFor();
    assert.equal(await broken.locator('.overview-kpis').count(), 0);
    await broken.close();
    const empty = await browser.newPage();
    const schemas = JSON.parse(readFileSync('public/data/schemas.json'));
    schemas.$defs.overview.properties.rows.minItems = 0;
    const schemaBody = JSON.stringify(schemas), emptyBody = JSON.stringify({ schema_name: 'overview', schema_version: '1.0.0', rows: [] });
    const emptyManifest = JSON.parse(readFileSync('public/data/manifest.json'));
    emptyManifest.schemas.sha256 = createHash('sha256').update(schemaBody).digest('hex');
    emptyManifest.datasets.overview.sha256 = createHash('sha256').update(emptyBody).digest('hex');
    await empty.route('**/data/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(emptyManifest) }));
    await empty.route('**/data/schemas.json', route => route.fulfill({ contentType: 'application/json', body: schemaBody }));
    await empty.route('**/data/overview.json', route => route.fulfill({ contentType: 'application/json', body: emptyBody }));
    await empty.goto(base + '/overview');
    await empty.getByRole('status').filter({ hasText: 'No frozen summary available' }).waitFor();
    assert.equal(await empty.locator('.overview-kpis').count(), 0);
    await empty.close();
    const loading = await browser.newPage();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await loading.route('**/data/overview.json', async route => { await hold; await route.continue(); });
    await loading.goto(base + '/overview');
    await loading.getByRole('status').filter({ hasText: 'Loading frozen summary' }).waitFor();
    assert.equal(await loading.locator('.overview-kpis').count(), 0);
    release();
    await loading.locator('.overview-kpis').waitFor();
    await loading.close();
    console.log('PASS: Page-1 bound values, semantic tables, source CI summary, no selectors, four widths, zoom-equivalent reflow, resize/motion lifecycle, refresh/history/keyboard, safe corrupt-data error and live data binding; no runtime/network errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
