const assert = require('node:assert/strict');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local validation only');
const baselineMode = process.argv.includes('--baseline');
const output = resolve('.wrangler/qa/responsive');
mkdirSync(output, { recursive: true });
const routes = ['overview', 'risk-vs-benefit', 'hte-validation', 'rollout', 'robustness'];
const ready = ['.overview-context', '.risk-evidence', '.hte-forest-table', '.rollout-charts', '.p5-rankings'];
const sizes = [[1513, 732], [1528, 772], [1440, 720], [1440, 768], [1600, 800], [1680, 820], [1920, 990], [1536, 864], [1440, 900], [1366, 768], [1280, 720], [1920, 720], [390, 844]];
const baselinePath = resolve(output, 'before.json');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const records = [];
    const before = !baselineMode && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath)) : [];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const [index, route] of routes.entries()) {
        await page.goto(`${base}/${route}`);
        await page.locator(ready[index]).waitFor();
        await page.waitForTimeout(300);
        const metrics = await page.evaluate(() => {
          const rect = selector => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          };
          return {
            height: document.documentElement.scrollHeight,
            width: document.documentElement.scrollWidth,
            header: rect('header'), brand: rect('.brand'), nav: rect('header nav'),
            zoom: getComputedStyle(document.querySelector('main')).zoom,
            transform: getComputedStyle(document.querySelector('main')).transform,
            clippedLinks: [...document.querySelectorAll('.report-tabs a')].some(e => e.scrollWidth > e.clientWidth + 1),
            clippedIntervalMarks: [...document.querySelectorAll('.hte-interval circle, .hte-interval text')].some(e => {
              const box = e.getBBox();
              return box.y < -1 || box.y + box.height > e.ownerSVGElement.clientHeight + 1;
            }),
            charts: [...document.querySelectorAll('.chart-surface')].map(e => ({
              width: e.clientWidth, height: e.clientHeight,
              svgWidth: e.querySelector('svg')?.getBoundingClientRect().width,
            })),
          };
        });
        const image = await page.screenshot({ fullPage: true });
        const record = { route, viewport: [width, height], ...metrics, imageHash: createHash('sha256').update(image).digest('hex') };
        records.push(record);
        if (!baselineMode) {
          assert(metrics.width <= width, `Horizontal document overflow: ${route} ${width}`);
          assert(['1', 'normal'].includes(metrics.zoom) && metrics.transform === 'none', 'No global scaling');
          assert(!metrics.clippedLinks, `Clipped navigation label: ${width}`);
          if (route === 'overview' && width >= 1440 && height >= 720 && height <= 840) {
            assert(metrics.height <= height, `Overview must use available height without avoidable scrolling: ${width}x${height}; actual ${metrics.height}`);
          }
          if (index < 3 && width >= 1440 && width <= 1600 && height >= 768) {
            assert(metrics.height <= height, `Complete evidence must fit the compact desktop target: ${route} ${width}x${height}; actual ${metrics.height}`);
          }
          for (const chart of metrics.charts) {
            assert(chart.height > 150 && chart.width > 100, 'Readable chart dimensions');
            assert(Math.abs(chart.svgWidth - chart.width) < 2, 'Chart follows resized container');
          }
          if (width >= 1280 && width <= 1600) {
            assert(metrics.header.height <= 100, `Avoidable two-row laptop header: ${width}`);
            assert(metrics.nav.y < metrics.brand.y + metrics.brand.height, 'Navigation shares brand row');
            assert(metrics.brand.width <= 400, `Brand column must not push navigation away: ${width}`);
            assert(metrics.nav.width <= 720, `Compact navigation must not spread across unused space: ${width}`);
          }
          const old = before.find(r => r.route === route && r.viewport[0] === width && r.viewport[1] === height);
          if (old && (width === 1920 && height === 990 || width === 390)) {
            assert.equal(record.imageHash, old.imageHash, `Approved monitor/mobile appearance: ${route} ${width}`);
          }
          if (old && index < 3 && width >= 1280 && width <= 1600) {
            assert(metrics.height <= old.height, `No added laptop scrolling: ${route} ${width}`);
            if (route === 'overview' || route === 'hte-validation') assert(metrics.height < old.height - 40, `Remove avoidable height: ${route} ${width}`);
          }
          if (route === 'rollout') assert(metrics.charts.every(c => c.height === 340), 'Preserve Page-4 plot height and natural scrolling');
          if (route === 'robustness') {
            assert(await page.locator('.p5-rank-scroll').evaluate(e => e.scrollHeight > e.clientHeight), 'All village rows remain scrollable');
            assert.equal(await page.locator('.p5-rankings tbody tr').count(), 127);
            if (width >= 1440 && width <= 1600) assert(await page.locator('.p5-rank-scroll').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'All nine village columns fit compact desktop width');
          }
          if (route === 'hte-validation') {
            assert.equal(await page.locator('.hte-forest-table tbody tr').count(), 13, 'All subgroup rows retained');
            assert(!metrics.clippedIntervalMarks, 'Compact SVGs retain every interval marker and value label');
          }
          if (width === 1366 || width === 1513) await page.screenshot({ path: resolve(output, `${route}-${width}.png`), fullPage: true });
        }
      }
    }
    if (!baselineMode) {
      await page.setViewportSize({ width: 1920, height: 990 });
      await page.goto(base + '/rollout?policy=grf&k=32');
      await page.locator('.rollout-charts .chart-surface svg').first().waitFor();
      const host = page.locator('.rollout-charts .chart-surface').first();
      const instance = await host.getAttribute('_echarts_instance_');
      const url = page.url();
      for (const [width, height] of [[1366, 768], [1920, 720], [1920, 990]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        assert.equal(page.url(), url, 'Resizing retains selectors and URL');
        assert.equal(await host.getAttribute('_echarts_instance_'), instance, 'Resize preserves chart instance');
        assert(await host.evaluate(e => Math.abs(e.clientWidth - e.querySelector('svg').getBoundingClientRect().width) < 2), 'Observer resizes SVG after monitor changes');
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.locator('header').click({ position: { x: 10, y: 10 } });
      await page.keyboard.press('ArrowRight');
      await page.waitForURL('**/robustness');
      await page.locator('.p5-rankings').waitFor();
      assert(await page.locator('header nav a[aria-current]').evaluate(e => document.activeElement === e), 'Arrow navigation retains active-link focus');
      const row = page.locator('.p5-rankings tbody tr').first();
      const id = await row.getAttribute('data-village');
      await row.click();
      await page.setViewportSize({ width: 1920, height: 990 });
      assert.equal(await page.locator('.p5-rankings tbody tr[data-selected="true"]').getAttribute('data-village'), id, 'Resize preserves selected Village ID');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.p5-rankings tbody tr[data-selected="true"]').count(), 0);
    }
    assert.deepEqual(errors, [], 'No browser errors');
    writeFileSync(baselineMode ? baselinePath : resolve(output, 'after.json'), JSON.stringify(records, null, 2) + '\n');
    console.log(`${baselineMode ? 'Baseline recorded' : 'Responsive checks PASS'}: ${records.length} route/viewport cases; ${before.length ? 'prior-render comparison enabled' : 'prior-render comparison not supplied'}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
