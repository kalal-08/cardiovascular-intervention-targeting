const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = resolve('.wrangler/qa/integration/native-zoom'); mkdirSync(output, { recursive: true });
const routes = [
  ['/overview', '.overview-kpis'], ['/risk-vs-benefit', '.risk-kpis'],
  ['/hte-validation', '.hte-top'], ['/rollout', '.rollout-kpis'], ['/robustness', '.p5-kpis'],
];
(async () => {
  // An isolated browser profile changes Chrome's actual Page zoom, not CSS or emulation.
  const context = await chromium.launchPersistentContext(resolve(output, 'profile'), {
    channel: 'chrome', headless: true, viewport: null, reducedMotion: 'reduce', args: ['--window-size=1920,1080'],
  });
  let settings;
  try {
    settings = await context.newPage(); await settings.goto('chrome://settings/appearance');
    const page = await context.newPage(), results = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    for (const zoom of ['0.8', '1', '1.25', '1.5', '2']) {
      await settings.locator('#zoomLevel').selectOption(zoom);
      for (const [route, loaded] of routes) {
        await page.goto(base + route); await page.locator(loaded).waitFor(); await page.evaluate(() => document.fonts.ready);
        await page.locator('main svg').first().waitFor(); await page.waitForTimeout(150);
        const geometry = await page.evaluate(() => ({
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          cssZoom: getComputedStyle(document.querySelector('main')).zoom,
          tables: [...document.querySelectorAll('table')].map(t => ({ rows: t.tBodies[0]?.rows.length || 0, headers: t.querySelectorAll('th').length })),
          missingNames: [...document.querySelectorAll('button,select,summary')].filter(e => !(e.matches('select') ? e.labels?.length : e.textContent.trim()) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length,
        }));
        assert(Math.abs(geometry.dpr - Number(zoom)) < 0.01, 'Native browser zoom must alter devicePixelRatio');
        assert(!geometry.overflow, `${route} page-level overflow at ${zoom}`);
        assert.equal(geometry.cssZoom, '1'); assert.equal(geometry.missingNames, 0);
        assert.equal(await page.locator('main h1').count(), 1);
        if (zoom === '2' && route === '/hte-validation') {
          const forest = page.locator('.hte-forest-scroll');
          assert.equal(await forest.locator('tbody tr').count(), 13);
          await forest.scrollIntoViewIfNeeded(); await forest.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
          assert(await forest.evaluate(e => e.scrollLeft > 0), 'Forest supports native horizontal keyboard scrolling');
          await forest.locator('tbody tr').last().locator('td').last().scrollIntoViewIfNeeded();
          assert(await forest.evaluate(e => e.scrollLeft + e.clientWidth >= e.scrollWidth - 2), 'The final interval/reference column is reachable');
        }
        if (zoom === '2' && route === '/rollout') {
          const policy = page.getByRole('button', { name: 'GRF', exact: true }); await policy.focus(); await page.keyboard.press('Enter');
          const capacity = page.getByRole('button', { name: '32 villages', exact: true }); await capacity.focus(); await page.keyboard.press('Enter');
          assert.equal(await policy.getAttribute('aria-pressed'), 'true'); assert.equal(await capacity.getAttribute('aria-pressed'), 'true');
          for (const chart of await page.locator('.rollout-chart-panel .chart-surface').all()) {
            await chart.scrollIntoViewIfNeeded(); const box = await chart.boundingBox(); assert(box.width > 200 && box.height >= 300);
            const d = await chart.locator('svg path[stroke="#0B2E83"][fill="none"]').first().getAttribute('d');
            const points = [...d.matchAll(/[ML]([\d.-]+)[ ,]([\d.-]+)/g)].map(m => [+m[1], +m[2]]); assert.equal(points.length, 128);
            await page.mouse.move(box.x + points[64][0], box.y + points[64][1]);
            const tooltip = page.getByRole('tooltip').filter({ visible: true }); await tooltip.waitFor();
            assert.match(await tooltip.innerText(), /Capacity K=64/); assert.equal(await tooltip.count(), 1);
            const bounds = await tooltip.boundingBox();
            assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= geometry.width + 1 && bounds.y + bounds.height <= geometry.height + 1);
            await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'hidden' });
          }
        }
        if (route === '/robustness') {
          const rows = page.locator('.p5-rankings tbody tr'); assert.equal(await rows.count(), 127);
          await rows.last().scrollIntoViewIfNeeded(); assert(await rows.last().isVisible());
          await rows.last().locator('button').focus(); await page.keyboard.press('Enter');
          assert.equal(await rows.last().getAttribute('data-selected'), 'true'); await page.keyboard.press('Escape');
          assert.equal(await page.locator('.p5-rankings [data-selected="true"]').count(), 0);
        }
        results.push({ route, zoom: Number(zoom), ...geometry });
        if (zoom === '2') {
          await page.evaluate(() => scrollTo(0, 0));
          const size = await page.evaluate(() => ({ width: innerWidth, height: document.documentElement.scrollHeight, dpr: devicePixelRatio }));
          // Chrome's native zoom uses device-independent capture coordinates; CSS-sized clips crop the report.
          const session = await context.newCDPSession(page);
          const capture = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: size.width * size.dpr, height: size.height * size.dpr, scale: 1 } });
          writeFileSync(resolve(output, route.slice(1) + '-200.png'), Buffer.from(capture.data, 'base64'));
          await session.detach();
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', browser: 'Chrome native Page zoom', cases: results.length,
      forestKeyboardAndFinalColumnAt200: true, rolloutSelectorsAndTwoTooltipBoundsAt200: true, results, errors, actualScreenReader: 'NOT RUN' }));
  } finally {
    if (settings && !settings.isClosed()) await settings.locator('#zoomLevel').selectOption('1').catch(() => {});
    await context.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
