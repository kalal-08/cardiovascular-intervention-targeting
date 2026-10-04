const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:4173';
const routes = [
  ['/overview', 'Overview', 'Trial Evidence Overview'],
  ['/risk-vs-benefit', 'Risk vs Benefit', 'Risk vs Predicted Benefit'],
  ['/hte-validation', 'HTE Validation', 'HTE Validation'],
  ['/rollout', 'Rollout', 'Rollout Across Capacity'],
  ['/robustness', 'Robustness', 'Robustness and Village Prioritization'],
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    let headerGeometry;
    for (const [route, label, title] of routes) {
      const response = await page.goto(base + route);
      assert.equal(response.status(), 200);
      await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
      assert.equal(await page.locator('nav a[aria-current="page"]').innerText(), label);
      const geometry = await page.locator('.header-inner').evaluate(header => ({ height: header.getBoundingClientRect().height,
        tabs: [...header.querySelectorAll('nav a[aria-current], .report-tabs a')].map(link => { const r = link.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }) }));
      assert.equal(geometry.height, 92, 'Desktop header height');
      assert.equal(geometry.tabs.length, 5, 'Five stable tab areas');
      if (headerGeometry) assert.deepEqual(geometry, headerGeometry, 'Header geometry stable across routes');
      headerGeometry = geometry;
      const current = page.locator('nav a[aria-current="page"]');
      await current.hover();
      assert.equal(await current.evaluate(link => getComputedStyle(link).backgroundColor), 'rgb(243, 247, 251)');
      assert.equal(await current.evaluate(link => link.getBoundingClientRect().height), 60, 'Hover does not fill the header');
      await page.mouse.move(0, 100);
      await page.reload();
      await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
    }
    await page.goto(base + '/');
    await page.waitForURL(base + '/overview');
    await page.getByRole('link', { name: 'Rollout', exact: true }).click();
    await page.waitForURL(base + '/rollout');
    await page.waitForFunction(() => document.activeElement === document.querySelector('header'));
    await page.goBack();
    await page.waitForURL(base + '/overview');
    await page.goForward();
    await page.waitForURL(base + '/rollout');
    assert.equal(await page.locator('nav a[aria-current="page"]').innerText(), 'Rollout');
    await page.goto(base + '/robustness?policy=grf&k=13');
    await page.reload();
    assert.equal(new URL(page.url()).search, '?policy=grf&k=13');
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('link', { name: 'Robustness', exact: true }).click();
    await page.waitForURL(base + '/robustness?policy=grf&k=13');
    await page.goto(base + '/risk-vs-benefit?signal=simple&policy=grf');
    await page.waitForURL(base + '/risk-vs-benefit?signal=simple');
    await page.getByRole('link', { name: 'Rollout', exact: true }).click();
    await page.waitForURL(base + '/rollout');
    await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
    await page.waitForURL(base + '/risk-vs-benefit?signal=simple');
    await page.goto(base + '/rollout?policy=wrong&k=13&k=64&unknown=x');
    await page.getByRole('status').filter({ hasText: 'Invalid state reset' }).waitFor();
    await page.waitForURL(base + '/rollout');
    await page.goto(base + '/overview?policy=grf');
    await page.waitForURL(base + '/overview');
    await page.goto(base + '/unknown');
    await page.getByRole('heading', { level: 1, name: 'Page not found', exact: true }).waitFor();
    if (process.env.CHECK_PRODUCTION === '1') {
      await page.goto(base + '/__spikes/page5');
      await page.getByRole('heading', { level: 1, name: 'Page not found', exact: true }).waitFor();
    }
    await page.goto(base + '/overview');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').innerText(), 'Skip to content');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'content');
    await page.getByRole('link', { name: 'Next page: Risk vs Benefit', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(base + '/risk-vs-benefit');
    assert.equal(await page.locator(':focus').getAttribute('aria-current'), 'page', 'Arrow navigation focuses active header link');
    assert.equal(await page.locator(':focus').evaluate(link => getComputedStyle(link).backgroundColor), 'rgb(243, 247, 251)', 'Visible keyboard focus reuses the hover shade');
    assert.equal(await page.locator(':focus').evaluate(link => getComputedStyle(link).textDecorationLine), 'none', 'No added text underline');
    assert.equal(await page.locator(':focus').evaluate(link => getComputedStyle(link).outlineStyle), 'none', 'No header focus box');
    await page.keyboard.press('ArrowLeft');
    await page.waitForURL(base + '/overview');
    await page.getByRole('link', { name: 'Next page: Risk vs Benefit', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(base + '/risk-vs-benefit');
    await page.getByRole('link', { name: 'Previous page: Overview', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(base + '/overview');
    const output = resolve('.wrangler/qa');
    mkdirSync(output, { recursive: true });
    for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844], [375, 812], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/overview');
      await page.getByRole('heading', { level: 1, name: 'Trial Evidence Overview' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        `Shell overflows horizontally at ${width}px`);
      assert.equal(await page.locator('.header').evaluate(header => {
        const items = [...header.querySelectorAll('.brand, .report-context, nav')].map(item => item.getBoundingClientRect());
        return items.every((a, i) => items.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
      }), true, `Header zones overlap at ${width}px`);
      assert.equal(await page.locator('.header').evaluate(header => [...header.querySelectorAll('p, a, .report-context span')].every(item => item.scrollWidth <= item.clientWidth + 1)), true, `Header text clips at ${width}px`);
      await page.screenshot({ path: resolve(output, `shell-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, [], 'Browser runtime/console errors');
    console.log('PASS: five routes + stable desktop header/compact hover, refresh, root, Back/Forward, active nav, query survival, unknown route, keyboard entry/arrows/focus, six widths/orientations; no header overlaps, clipping or console errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
