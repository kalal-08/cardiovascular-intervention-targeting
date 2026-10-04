const assert = require('node:assert/strict');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const cases = [
  ['/overview', null, '/risk-vs-benefit'],
  ['/risk-vs-benefit', '/overview', '/hte-validation'],
  ['/hte-validation', '/risk-vs-benefit', '/rollout'],
  ['/rollout', '/hte-validation', '/robustness'],
  ['/robustness', '/rollout', null],
];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 990 } });
  const watch = p => {
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  };
  watch(page);
  await page.addInitScript(() => {
    // Chromium caps session-history length; count real pushes rather than relying on that cap.
    window.navigationPushes = 0;
    document.addEventListener('keydown', event => { window.headerKeyPrevented = event.defaultPrevented; });
    const push = history.pushState;
    history.pushState = function (...args) { window.navigationPushes++; return push.apply(this, args); };
  });
  const active = p => p.locator('header nav a[aria-current="page"]');
  async function expectRoute(p, path, headerFocus = 'link') {
    await p.waitForURL(url => url.pathname === path);
    await p.waitForFunction(focus => {
      const link = document.querySelector('header nav a[aria-current="page"]');
      return link && (!focus || document.activeElement === (focus === 'header' ? document.querySelector('header') : link));
    }, headerFocus);
    if (headerFocus) {
      assert.equal(await active(p).evaluate(n => getComputedStyle(n).outlineStyle), 'none', 'No rectangular header focus block');
      assert.equal(await active(p).evaluate(n => getComputedStyle(n).textDecorationLine), 'none', 'No added text underline');
      if (await active(p).evaluate(n => n.matches(':focus-visible'))) assert.equal(await active(p).evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(243, 247, 251)', 'Keyboard focus reuses the existing neutral hover treatment');
    }
  }
  try {
    let pointerActivations = 0;
    for (const [path, , right] of cases) {
      for (const selector of ['.product', '.subtitle', '.report-context span:first-child', '.report-context span:last-child', 'header']) {
        await page.goto(base + path); await active(page).waitFor();
        const before = await page.locator('header').evaluate(n => [n, ...n.querySelectorAll('.brand, nav, nav a, .report-context')].map(item => {
          const r = item.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
        }));
        await page.locator(selector).click(selector === 'header' ? { position: { x: 3, y: 3 } } : {});
        assert(await page.locator('header').evaluate(n => n === document.activeElement), `${path}: clicking ${selector} focuses the white header, not its text`);
        assert.equal(await page.locator(selector).evaluate(n => getComputedStyle(n).userSelect), 'none', 'Header text behaves like static presentation, without becoming an image');
        assert.equal(await active(page).evaluate(n => getComputedStyle(n).outlineStyle), 'none', 'Pointer activation adds no focus box');
        assert.deepEqual(await page.locator('header').evaluate(n => [n, ...n.querySelectorAll('.brand, nav, nav a, .report-context')].map(item => {
          const r = item.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
        })), before, 'Click activation preserves header geometry');
        await page.keyboard.press('ArrowRight'); await expectRoute(page, right ?? path, right ? 'link' : 'header');
        pointerActivations++;
      }
      await page.goto(base + path); await active(page).waitFor();
      const destinations = await page.locator('header nav a').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-report-page')));
      for (let index = 0; index < destinations.length; index++) {
        await page.goto(base + path);
        await page.locator('header nav a').nth(index).click(); await expectRoute(page, destinations[index], 'header');
        await page.keyboard.press('ArrowRight');
        const next = cases.find(([route]) => route === destinations[index])[2];
        await expectRoute(page, next ?? destinations[index], next ? 'link' : 'header');
        pointerActivations++;
      }
    }
    await page.goto(base + '/overview');
    const title = await page.locator('.product').boundingBox();
    await page.mouse.move(title.x + 2, title.y + title.height / 2); await page.mouse.down();
    await page.mouse.move(title.x + title.width - 2, title.y + title.height / 2, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), '', 'Dragging header wording does not select text');
    assert.equal(await page.locator('header').evaluate(n => n.isContentEditable), false, 'Header is not an editor');
    await page.goto(base + '/overview'); await active(page).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit', 'Focused header Right arrow switches to the adjacent page');
    let switches = 0;
    for (const [path, left, right] of cases) {
      await page.goto(base + path);
      await active(page).waitFor();
      const controls = await page.locator('header nav a').count();
      for (let index = 0; index < controls; index++) for (const [key, destination] of [['ArrowLeft', left], ['ArrowRight', right]]) {
        await page.goto(base + path);
        const control = page.locator('header nav a').nth(index);
        await control.focus();
        assert(await control.evaluate(n => {
          const description = document.getElementById(n.getAttribute('aria-describedby'));
          return description && /left/i.test(description.textContent) && /right/i.test(description.textContent);
        }), 'Every eligible link has the shared accessible instruction');
        const history = await page.evaluate(() => window.navigationPushes);
        await page.keyboard.press(key);
        assert.equal(await page.evaluate(() => window.headerKeyPrevented), true, 'Eligible arrow presses are consumed, including boundary no-ops');
        assert.equal(new URL(page.url()).pathname, destination ?? path, `${path}, control ${index}, ${key}: adjacent to displayed page`);
        await expectRoute(page, destination ?? path, !!destination);
        assert.equal(await page.evaluate(() => window.navigationPushes), history + (destination ? 1 : 0), 'Exactly one navigation, none at boundaries');
        if (!destination) assert(await control.evaluate(n => document.activeElement === n), 'Boundary preserves the focused control');
        switches++;
      }
    }
    await page.goto(base + '/overview'); await active(page).focus();
    for (const [key, path] of [['ArrowRight', '/risk-vs-benefit'], ['ArrowRight', '/hte-validation'], ['ArrowRight', '/rollout'], ['ArrowRight', '/robustness'], ['ArrowLeft', '/rollout'], ['ArrowLeft', '/hte-validation']]) {
      await page.keyboard.press(key); await expectRoute(page, path);
    }
    await page.goto(base + '/risk-vs-benefit'); await active(page).focus();
    const rapidHistory = await page.evaluate(() => window.navigationPushes);
    await page.evaluate(() => {
      for (let press = 0; press < 3; press++) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    await expectRoute(page, '/robustness');
    assert.equal(await page.evaluate(() => window.navigationPushes), rapidHistory + 3, 'Same-turn presses use the latest route, not a stale render closure');
    await page.goto(base + '/overview'); await active(page).focus();
    await page.keyboard.down('ArrowRight'); await expectRoute(page, '/risk-vs-benefit');
    await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit', 'Held-key repeat does not advance again');
    for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }, { cancelled: true }]) {
      const prevented = await active(page).evaluate((n, options) => {
        const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...options });
        if (options.cancelled) e.preventDefault();
        n.dispatchEvent(e); return e.defaultPrevented;
      }, options);
      assert.equal(prevented, !!options.cancelled, 'Ignored shortcuts/composition/repeats are not intercepted');
      assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit');
    }
    await page.locator('main').focus(); await page.getByRole('link', { name: 'Rollout', exact: true }).hover();
    await page.keyboard.press('ArrowRight'); assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit', 'Hover alone does not activate navigation');
    await page.locator('.brand').evaluate(n => { n.tabIndex = -1; n.focus(); });
    await page.keyboard.press('ArrowLeft'); assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit', 'Brand focus is outside scope');
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).focus();
    await page.keyboard.press('ArrowRight'); assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit', 'Selector focus is outside scope');
    await page.evaluate(() => {
      const fixture = document.createElement('div'); fixture.id = 'native-control-check';
      fixture.innerHTML = '<input aria-label="Native edit check" value="abcd"><select aria-label="Native select check"><option>A</option><option>B</option></select><input aria-label="Native range check" type="range" min="0" max="10" value="5">';
      document.querySelector('main').prepend(fixture);
    });
    const input = page.getByLabel('Native edit check'); await input.focus(); await input.evaluate(n => n.setSelectionRange(2, 2));
    await page.keyboard.press('ArrowLeft'); assert.equal(await input.evaluate(n => n.selectionStart), 1);
    const select = page.getByLabel('Native select check'); await select.focus(); await page.keyboard.press('ArrowDown'); assert.equal(await select.inputValue(), 'B');
    const range = page.getByLabel('Native range check'); await range.focus(); await page.keyboard.press('ArrowRight'); assert.equal(await range.inputValue(), '6');
    assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit', 'Native input/select/range behavior does not switch pages');
    await page.evaluate(() => document.getElementById('native-control-check').remove());
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    await page.locator('.risk-point-values summary').click();
    const table = page.locator('.risk-value-scroll'); await table.focus();
    await page.keyboard.press('ArrowDown'); await page.waitForFunction(() => document.querySelector('.risk-value-scroll').scrollTop > 0);
    assert.equal(new URL(page.url()).pathname, '/risk-vs-benefit');
    assert.equal(new URL(page.url()).search, '?signal=simple');
    await active(page).focus(); await page.keyboard.press('ArrowRight'); await expectRoute(page, '/hte-validation');
    await page.keyboard.press('ArrowLeft'); await expectRoute(page, '/risk-vs-benefit');
    assert.equal(new URL(page.url()).search, '?signal=simple', 'Arrow navigation restores page-scoped state');
    await page.reload(); assert.equal(new URL(page.url()).search, '?signal=simple');
    await active(page).focus(); await page.keyboard.press('ArrowRight'); await expectRoute(page, '/hte-validation');
    await page.goBack(); await expectRoute(page, '/risk-vs-benefit', false);
    assert.equal(new URL(page.url()).search, '?signal=simple');
    await page.goForward(); await expectRoute(page, '/hte-validation', false);
    assert(await page.locator('header').evaluate(n => !n.contains(document.activeElement)), 'History navigation exits header keyboard scope');
    await page.keyboard.press('ArrowLeft'); assert.equal(new URL(page.url()).pathname, '/hte-validation');
    for (const [url, away, back] of [
      ['/rollout?policy=baseline_risk&k=32', 'ArrowLeft', 'ArrowRight'],
      ['/robustness?policy=grf&k=95&dimension=income&sort=participants&direction=desc', 'ArrowLeft', 'ArrowRight'],
    ]) {
      await page.goto(base + url); await active(page).focus();
      await page.keyboard.press(away); await page.keyboard.press(back);
      await page.waitForURL(base + url);
      assert(await active(page).evaluate(n => n === document.activeElement), 'Placeholder-page URL selectors/sort state restore without broadcast');
    }
    await page.goto(base + '/hte-validation'); await active(page).waitFor();
    const first = page.locator('header nav a').first(); await first.focus();
    await page.keyboard.press('Tab'); assert(await page.locator('header nav a').nth(1).evaluate(n => document.activeElement === n));
    await page.keyboard.press('Shift+Tab'); assert(await first.evaluate(n => document.activeElement === n));
    for (let step = 0; step < await page.locator('header nav a').count(); step++) await page.keyboard.press('Tab');
    assert(await page.locator('header nav').evaluate(n => !n.contains(document.activeElement)), 'Tab exits header navigation without a trap');
    await page.keyboard.press('ArrowLeft'); assert.equal(new URL(page.url()).pathname, '/hte-validation', 'Arrows stop when Tab leaves the header');
    await page.keyboard.press('Shift+Tab');
    assert(await page.locator('header nav a').last().evaluate(n => document.activeElement === n), 'Shift+Tab re-enters the last header control');
    await page.getByRole('link', { name: 'Rollout', exact: true }).focus(); await page.keyboard.press('Enter');
    await expectRoute(page, '/rollout');
    await page.keyboard.press('ArrowRight'); await expectRoute(page, '/robustness');
    for (const selector of ['main h1', 'main']) {
      await page.locator(selector).click(selector === 'main' ? { position: { x: 3, y: 3 } } : {});
      assert(await page.locator('header').evaluate(n => !n.contains(document.activeElement)), 'Clicking outside ends header focus, including non-interactive space');
      await page.keyboard.press('ArrowLeft'); assert.equal(new URL(page.url()).pathname, '/robustness');
      await page.locator('.product').click();
    }
    await page.getByRole('link', { name: 'Robustness', exact: true }).click(); await expectRoute(page, '/robustness', 'header');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(base + '/rollout'); await page.locator('.rollout-charts').waitFor(); await page.locator('.product').click();
    assert(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'Native-scroll check requires a scrollable document');
    await page.keyboard.press('ArrowDown'); await page.waitForFunction(() => scrollY > 0);
    const scroll = await page.evaluate(() => scrollY); await page.keyboard.press('ArrowUp'); await page.waitForFunction(y => scrollY < y, scroll);
    assert.equal(new URL(page.url()).pathname, '/rollout', 'Header Up/Down scrolls without navigation');
    assert(await page.locator('header').evaluate(n => document.activeElement === n), 'Up/Down scrolling keeps mouse-activated white-header focus');
    for (const followUp of ['load', 'mouse', 'history', 'outside']) {
      const cold = await browser.newPage({ viewport: { width: 1920, height: 990 } }); watch(cold);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let requested;
      const request = new Promise(resolve => { requested = resolve; });
      await cold.route('**/assets/HTEValidation-*.js', async route => { requested(); await gate; await route.continue(); });
      try {
        await cold.goto(base + '/risk-vs-benefit?signal=simple'); await cold.locator('.risk-range').waitFor(); await active(cold).focus();
        await cold.keyboard.press('ArrowRight'); await request; await expectRoute(cold, '/hte-validation');
        if (followUp === 'mouse') { await cold.getByRole('link', { name: 'Rollout', exact: true }).click(); await expectRoute(cold, '/rollout', 'header'); }
        if (followUp === 'history') { await cold.goBack(); await expectRoute(cold, '/risk-vs-benefit', false); }
        if (followUp === 'outside') await cold.locator('main').click({ position: { x: 3, y: 3 } });
        release();
        if (followUp === 'load') { await cold.locator('.hte-forest-table').waitFor(); await expectRoute(cold, '/hte-validation'); }
        else {
          await cold.waitForTimeout(200);
          if (followUp === 'mouse') await expectRoute(cold, '/rollout', 'header');
          else assert(await cold.locator('header').evaluate(n => !n.contains(document.activeElement)), 'Late lazy completion does not re-enable header focus after outside/history navigation');
        }
      } finally { release(); await cold.close(); }
    }
    await page.goto(base + '/risk-vs-benefit'); await active(page).focus();
    await page.evaluate(() => {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      document.querySelector('header .report-tabs a[href="/rollout"]').click();
    });
    await expectRoute(page, '/rollout');
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }); watch(touch);
    try {
      await touch.goto(base + '/overview'); await touch.locator('.product').tap(); await expectRoute(touch, '/overview', 'header');
      await touch.keyboard.press('ArrowRight'); await expectRoute(touch, '/risk-vs-benefit');
      await touch.getByRole('link', { name: 'HTE Validation', exact: true }).tap(); await expectRoute(touch, '/hte-validation', 'header');
      await touch.getByRole('heading', { name: 'HTE Validation', exact: true }).tap(); await touch.keyboard.press('ArrowLeft');
      assert.equal(new URL(touch.url()).pathname, '/hte-validation', 'Touch outside ends header keyboard scope');
    } finally { await touch.close(); }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', pointerActivations, touchActivation: true, headerControlDirections: switches, rapidLatestRoute: true, scopedKeys: true, nativeControlsAndScrolling: true, lazyLoadFocus: true, mouseHistoryCancellation: true, pageStateHistory: true, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
