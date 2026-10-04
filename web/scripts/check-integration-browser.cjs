const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const modulePath = process.argv[3] || 'playwright';
const { chromium } = require(modulePath);
const { PNG } = require(modulePath === 'playwright' ? 'pngjs' : resolve(modulePath, '../pngjs'));
const base = process.argv[2] || 'http://127.0.0.1:4173';
const channel = process.argv[4] || 'msedge';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert(['chrome', 'msedge'].includes(channel));
const output = resolve('.wrangler/qa/integration', channel); mkdirSync(output, { recursive: true });
const pages = [
  ['/overview', 'Overview', '.overview-kpis', '../reports/figures/web/pages_01_03_approved_20261003/page_01_overview.png'],
  ['/risk-vs-benefit', 'Risk vs Benefit', '.risk-kpis', '../reports/figures/web/pages_01_03_approved_20261003/page_02_risk_vs_benefit_grf.png'],
  ['/hte-validation', 'HTE Validation', '.hte-top', '../reports/figures/web/pages_01_03_approved_20261003/page_03_hte_validation.png'],
  ['/rollout', 'Rollout', '.rollout-kpis', '../reports/figures/web/phase12c8_page4_polish_20261003/page4-default.png'],
  ['/robustness', 'Robustness', '.p5-kpis', '../reports/figures/web/phase12c9_page5_20261003/page5-default.png'],
];
const layouts = [], comparisons = [], semantics = [], lazy = [], navigationRenderMs = [];
function compare(actual, expected) {
  const a = PNG.sync.read(actual), b = PNG.sync.read(readFileSync(expected));
  if (a.width !== b.width || a.height !== b.height) return { sameDimensions: false, current: [a.width, a.height], reference: [b.width, b.height] };
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c]))) > 24) different++;
  }
  return { sameDimensions: true, significantPixelDifference: different / (a.width * a.height) };
}
(async () => {
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 990 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], failures = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => failures.push(new URL(r.url()).pathname));
    const ready = async route => { await page.locator(pages.find(p => p[0] === route)[2]).waitFor(); await page.evaluate(() => document.fonts.ready); };
    for (const [route, , loaded, reference] of pages) {
      const requests = [], watch = r => requests.push(new URL(r.url()).pathname);
      page.on('request', watch);
      const start = performance.now(); await page.goto(base + route); await ready(route);
      await page.locator(['/hte-validation', '/robustness'].includes(route) ? 'main svg' : '.chart-surface svg').first().waitFor();
      navigationRenderMs.push({ route, ms: +(performance.now() - start).toFixed(1) });
      page.off('request', watch);
      assert.equal(await page.locator('main').count(), 1); assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('header nav[aria-label="Report pages"]').count(), 1);
      assert.equal(await page.locator('header nav a[aria-current="page"]').count(), 1);
      const semantic = await page.evaluate(() => ({
        tables: document.querySelectorAll('table').length,
        unnamedControls: [...document.querySelectorAll('button,select,summary')].filter(e =>
          !(e.matches('select') ? e.labels?.length : e.textContent.trim()) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length,
        charts: [...document.querySelectorAll('.chart-surface')].map(e => ({ labelled: !!e.getAttribute('aria-labelledby'), described: !!e.getAttribute('aria-describedby'), paths: e.querySelectorAll('svg path').length })),
      }));
      assert.equal(semantic.unnamedControls, 0); assert(semantic.charts.every(c => c.labelled && c.described && c.paths > 0));
      semantics.push({ route, ...semantic });
      lazy.push({ route, chartChunkRequested: requests.some(p => /EChart-.*\.js/.test(p)) });
      assert.equal(lazy.at(-1).chartChunkRequested, ['/overview', '/risk-vs-benefit', '/rollout'].includes(route));
      await page.mouse.move(0, 100); await page.waitForTimeout(200);
      // Page 5 was approved at 1080px; compare at its original capture viewport.
      if (route === '/robustness') { await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(120); }
      comparisons.push({ route, ...compare(await page.screenshot({ path: resolve(output, route.slice(1) + '-default.png'), fullPage: true }), reference) });
      assert(comparisons.at(-1).sameDimensions, `${route} approval dimensions differ`);
      assert(comparisons.at(-1).significantPixelDifference < 0.001, `${route} differs from its approved render`);
      for (const [width, height] of [[1920, 990], [1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(120);
        const geometry = await page.evaluate(() => ({ contentHeight: document.documentElement.scrollHeight, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          mainZoom: getComputedStyle(document.querySelector('main')).zoom, mainTransform: getComputedStyle(document.querySelector('main')).transform }));
        assert(!geometry.pageOverflow, `${route} page-level overflow at ${width}`);
        assert(['1', 'normal'].includes(geometry.mainZoom)); assert.equal(geometry.mainTransform, 'none');
        layouts.push({ route, width, height, ...geometry });
        if (width === 390) await page.screenshot({ path: resolve(output, route.slice(1) + '-mobile.png'), fullPage: true });
      }
      await page.setViewportSize({ width: 1920, height: 990 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; }); await page.waitForTimeout(120);
      assert(await page.locator(loaded).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.reload(); await ready(route); assert.equal(new URL(page.url()).pathname, route);
    }
    // Cache, cross-route state and navigation are one uninterrupted user session.
    await page.goto(base + '/overview'); await ready('/overview');
    const network = [], watch = r => network.push({ path: new URL(r.url()).pathname, type: r.resourceType(), origin: new URL(r.url()).origin });
    page.on('request', watch); const documentRequests = [];
    page.on('request', r => { if (r.resourceType() === 'document') documentRequests.push(r.url()); });
    const navigate = async label => { const route = pages.find(p => p[1] === label)[0]; await page.getByRole('link', { name: label, exact: true }).click(); await ready(route); };
    await navigate('Risk vs Benefit'); await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    assert.equal(new URL(page.url()).search, '?signal=simple');
    const disclosure = page.locator('.risk-point-values'), summary = disclosure.locator('summary');
    await summary.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => document.querySelector('.risk-point-values').open);
    const sourceIds = JSON.parse(readFileSync('public/data/villages.json')).rows.map(r => r.village_id);
    assert.deepEqual(await disclosure.locator('tbody th').allTextContents(), sourceIds);
    await page.getByRole('button', { name: 'GRF', exact: true }).click(); assert(await disclosure.getAttribute('open') !== null);
    assert.match(await disclosure.locator('thead').innerText(), /GRF benefit/);
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    await disclosure.locator('tbody tr').last().scrollIntoViewIfNeeded();
    await summary.click(); await page.waitForFunction(() => !document.querySelector('.risk-point-values').open);
    assert(await summary.evaluate(e => document.activeElement === e));
    assert(await page.evaluate(() => scrollY <= document.documentElement.scrollHeight - innerHeight + 1));
    await navigate('HTE Validation'); assert.equal(await page.locator('.hte-forest-table tbody tr').count(), 13);
    await navigate('Rollout'); await page.getByRole('button', { name: 'GRF', exact: true }).click(); await page.getByRole('button', { name: '32 villages', exact: true }).click();
    const rolloutURL = page.url(); assert.match(rolloutURL, /policy=grf&k=32$/);
    await navigate('Robustness'); await page.getByRole('button', { name: 'Baseline Risk', exact: true }).click(); await page.getByRole('button', { name: '95 villages', exact: true }).click();
    await page.locator('.p5-coverage select').selectOption('income'); await page.locator('[data-sort="participants"]').click(); await page.locator('[data-sort="participants"]').click();
    await page.locator('.p5-rankings [data-village="71"] td').last().click();
    await page.getByRole('button', { name: 'GRF', exact: true }).click();
    assert.equal(await page.locator('.p5-rankings [data-village="71"]').getAttribute('data-selected'), 'true');
    assert.equal(await page.locator('.p5-rankings th[aria-sort]').getAttribute('aria-sort'), 'descending');
    const robustnessURL = page.url(); assert.match(robustnessURL, /policy=grf&k=95&dimension=income&sort=participants&direction=desc$/);
    await navigate('Risk vs Benefit'); assert.equal(new URL(page.url()).search, '?signal=simple');
    await navigate('Rollout'); assert.equal(page.url(), rolloutURL);
    await navigate('Robustness'); assert.equal(page.url(), robustnessURL);
    await page.waitForFunction(() => document.querySelectorAll('.p5-rankings [data-selected="true"]').length === 0);
    await navigate('Overview'); await page.goBack(); await ready('/robustness'); assert.equal(page.url(), robustnessURL);
    await page.goForward(); await ready('/overview'); assert.equal(new URL(page.url()).search, '');
    assert.equal(documentRequests.length, 0, 'Normal navigation/history must not reload the document');
    assert(network.every(r => r.origin === new URL(base).origin), 'Runtime requests must stay same-origin');
    const dataRequests = network.filter(r => r.path.startsWith('/data/')).map(r => r.path);
    assert.equal(new Set(dataRequests).size, dataRequests.length, 'Datasets must be cached across this session');
    page.off('request', watch);
    await page.goto(robustnessURL); await ready('/robustness'); await page.reload(); await ready('/robustness'); assert.equal(page.url(), robustnessURL);
    await page.goto(base + '/robustness'); await ready('/robustness'); assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('.p5-rankings [aria-sort]').getAttribute('aria-sort'), 'ascending');
    assert.equal(await page.locator('.p5-rankings tbody tr').first().getAttribute('data-village'), '33');
    for (const [url, route, canonical] of [
      ['/risk-vs-benefit?signal=bad&k=95', '/risk-vs-benefit', ''],
      ['/rollout?policy=bad&k=32&signal=simple', '/rollout', '?k=32'],
      ['/robustness?policy=grf&k=bad&dimension=sex&sort=bad&direction=desc', '/robustness', '?policy=grf&dimension=sex&direction=desc'],
    ]) { await page.goto(base + url); await ready(route); assert.equal(new URL(page.url()).search, canonical); assert.equal(await page.locator('.status-notice[role="status"]').count(), 1); }
    await page.goto(base + '/'); await ready('/overview'); assert.equal(new URL(page.url()).pathname, '/overview');
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    console.log(JSON.stringify({ status: 'PASS', browser: channel, version: browser.version(), routes: 5, directRefresh: true, crossPageIsolation: true,
      sessionCache: dataRequests, noNavigationReload: true, expandedTable: true, rowHighlight: true, historyResetInvalid: true,
      semanticAudit: semantics, root20px: true, realBrowserZoom: 'NOT RUN BY THIS RUNNER', actualScreenReader: 'NOT RUN', lazy, navigationRenderMs, comparisons, layouts, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
