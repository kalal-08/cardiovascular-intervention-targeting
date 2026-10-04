const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const validation = JSON.parse(readFileSync('public/data/validation.json')).rows;
const subgroups = JSON.parse(readFileSync('public/data/subgroups.json')).rows;
const output = process.env.SAVE_REVIEW === '1' ? resolve('../reports/figures/web/phase12c7_page3_qa_20261002') : resolve('.wrangler/qa/page3');
mkdirSync(output, { recursive: true });
const counts = n => n.toLocaleString('en-US');
const fixed = (n, digits) => n.toFixed(digits).replace('-', '−');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [], failed = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => failed.push(r.url()));
    const started = Date.now();
    await page.goto(base + '/hte-validation');
    await page.getByRole('table', { name: 'Adjusted classical subgroup effects' }).waitFor({ timeout: 6000 });
    const initialRenderMs = Date.now() - started;
    const main = page.locator('main');
    assert.equal(await main.locator('select, input, button').count(), 0, 'No analytical controls');
    const autoc = page.getByRole('table', { name: 'AUTOC estimates and intervals' });
    const calibration = page.getByRole('table', { name: 'Calibration estimates and intervals' });
    const agreement = page.getByRole('table', { name: 'Participant-score ranking agreement' });
    const forest = page.getByRole('table', { name: 'Adjusted classical subgroup effects' });
    assert.equal(await autoc.locator('tbody tr').count(), 4);
    assert.equal(await calibration.locator('tbody tr').count(), 2);
    assert.equal(await agreement.locator('tbody tr').count(), 3);
    assert.equal(await forest.locator('tbody tr').count(), 13);
    assert(await page.locator('.hte-method-baseline_risk').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).color === 'rgb(242, 140, 0)')), 'Exact orange text is the user-authorized contrast exception');
    const labelColors = await page.locator('.hte-validation-table tbody th span:not(.hte-method-baseline_risk)').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).color));
    for (const color of labelColors) {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
      const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      assert(1.05 / (luminance + .05) >= 4.5, `Small method label contrast: ${color}`);
    }
    for (const [table, ids, digits, domain, reference] of [
      [autoc, ['rate:within_fold:AUTOC:grf', 'rate:within_fold:AUTOC:simple', 'rate:within_fold:AUTOC:baseline_risk', 'rate:within_fold:AUTOC:random'], 4, [-0.5, 1.5], 0],
      [calibration, ['calibration:grf', 'calibration:simple'], 3, [0, 1.8], 1],
    ]) {
      for (const [index, id] of ids.entries()) {
        const source = validation.find(row => row.validation_id === id), row = table.locator('tbody tr').nth(index);
        assert((await row.innerText()).includes(fixed(source.estimate, digits)));
        const graphic = row.getByRole('img');
        const detail = await graphic.getAttribute('aria-label');
        for (const number of [source.estimate, source.ci_lower, source.ci_upper]) assert(detail.includes(fixed(number, 4)));
        const positions = await graphic.evaluate(svg => ({ point: svg.querySelector('circle').getAttribute('cx'), lower: svg.querySelector('.interval-line').getAttribute('x1'), upper: svg.querySelector('.interval-line').getAttribute('x2'), reference: svg.querySelector('.interval-reference').getAttribute('x1') }));
        for (const [key, value] of Object.entries({ point: source.estimate, lower: source.ci_lower, upper: source.ci_upper, reference }))
          assert(Math.abs(parseFloat(positions[key]) - (value - domain[0]) / (domain[1] - domain[0]) * 100) < 1e-9);
      }
    }
    assert.deepEqual(await agreement.locator('tbody td:last-child').allTextContents(), ['0.6191', '0.7249', '0.6820']);
    for (const [index, source] of subgroups.entries()) {
      const row = forest.locator('tbody tr').nth(index);
      const text = await row.innerText();
      assert(text.includes(counts(source.analysis_n)), `N for subgroup ${index}`);
      assert(text.includes(`${fixed(source.treatment_effect, 3)} (${fixed(source.ci_lower, 3)} to ${fixed(source.ci_upper, 3)})`));
      const svg = row.getByRole('img');
      assert((await svg.getAttribute('aria-label')).includes(source.reconstruction_status === 'PARTIALLY RECONSTRUCTABLE' ? 'Groups partially reconstructable' : 'Descriptive full-data estimate'));
      const point = await svg.locator('circle').getAttribute('cx');
      assert(Math.abs(parseFloat(point) - (source.treatment_effect + 4) / 5 * 100) < 1e-9);
      assert.equal(await svg.locator('circle').getAttribute('fill'), index === 0 ? '#081B4B' : '#FFFFFF');
    }
    assert((await forest.locator('tbody tr').last().innerText()).includes('≥16%'), 'Final baseline-risk subgroup must remain readable');
    assert.equal(await page.locator('.hte-evidence-status strong').nth(0).innerText(), 'SUPPORTED');
    assert.equal(await page.locator('.hte-evidence-status strong').nth(1).innerText(), 'SUPERIORITY NOT DEMONSTRATED');
    assert.equal(await page.locator('.hte-boundaries li').count(), 7);
    for (const phrase of ['both 95% confidence intervals', 'partially reconstructable', 'not observed cardiovascular events', 'not out-of-village prioritization validation'])
      assert((await main.innerText()).toLowerCase().includes(phrase));
    assert(!(await main.innerText()).includes('BH'), 'Do not introduce a BH annotation');
    // Source-backed CI detail is equally available on pointer hover and keyboard focus.
    await autoc.locator('tbody tr').first().hover();
    assert(await autoc.locator('tbody tr').first().locator('.hte-detail').isVisible());
    await page.keyboard.press('Escape');
    await autoc.locator('tbody tr').first().locator('.hte-detail').waitFor({ state: 'hidden' });
    assert(!(await autoc.locator('tbody tr').first().locator('.hte-detail').isVisible()), 'Pointer tooltip must dismiss without moving pointer');
    await page.mouse.move(0, 0);
    await autoc.locator('tbody tr').first().focus();
    assert(await autoc.locator('tbody tr').first().locator('.hte-detail').isVisible());
    await page.keyboard.press('Escape');
    await autoc.locator('tbody tr').first().locator('.hte-detail').waitFor({ state: 'hidden' });
    assert(!(await autoc.locator('tbody tr').first().locator('.hte-detail').isVisible()), 'Focus tooltip must dismiss without moving focus');
    await page.locator('h1').focus();
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow ${width}`);
      assert(await main.locator('th, td, li, h2, .hte-evidence-status').evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1)), `Clipping ${width}`);
      assert(await forest.locator('tbody tr').last().getByRole('img').isVisible());
      const scroll = page.locator('.hte-forest-scroll');
      if (width >= 1366) assert(await scroll.evaluate(n => n.scrollWidth <= n.clientWidth + 1), 'Desktop forest must show the whole interval area without horizontal scrolling');
      if (await scroll.evaluate(n => n.scrollWidth > n.clientWidth)) {
        await scroll.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('.hte-forest-scroll').scrollLeft > 0);
        await scroll.evaluate(n => { n.scrollLeft = n.scrollWidth; });
        assert(await forest.locator('tbody tr').last().getByRole('img').evaluate(n => { const plot = n.getBoundingClientRect(), area = n.closest('.hte-forest-scroll').getBoundingClientRect(); return plot.right <= area.right + 1 && plot.left >= area.left; }), 'Final subgroup interval reachable by local scroll');
        await scroll.evaluate(n => { n.scrollLeft = 0; });
        await page.evaluate(() => document.activeElement?.blur());
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve(output, `hte-validation-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 960, height: 540 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Enlarged text page overflow');
    assert(await main.locator('th, td, li, h2, .hte-evidence-status').evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1)), 'Enlarged text clipping');
    await page.locator('.hte-forest-scroll').evaluate(n => { n.scrollLeft = 0; });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: resolve(output, 'hte-validation-enlarged-text.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload(); await forest.waitFor();
    await page.getByRole('link', { name: 'Risk vs Benefit', exact: true }).click();
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    await page.getByRole('link', { name: 'HTE Validation', exact: true }).click(); await forest.waitFor();
    assert.equal(new URL(page.url()).search, '');
    await page.goBack();
    assert.equal(await page.getByRole('button', { name: 'Simple HTE', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.goForward(); await forest.waitFor();
    await page.goto(base + '/hte-validation?policy=grf&signal=simple&k=95'); await forest.waitFor();
    assert.equal(new URL(page.url()).search, '');
    await page.reload(); await forest.waitFor();
    assert.deepEqual(errors, []); assert.deepEqual(failed, []);
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: resolve(output, 'hte-validation-1920.png'), fullPage: true });
    await page.locator('.hte-forest').screenshot({ path: resolve(output, 'hte-validation-forest.png') });
    await page.locator('.hte-evidence').screenshot({ path: resolve(output, 'hte-validation-evidence.png') });
    async function intercepted(documents) {
      const target = await browser.newPage();
      const manifest = JSON.parse(readFileSync('public/data/manifest.json'));
      for (const [name, document] of Object.entries(documents)) {
        const body = JSON.stringify(document);
        if (name === 'schemas') manifest.schemas.sha256 = createHash('sha256').update(body).digest('hex');
        else manifest.datasets[name].sha256 = createHash('sha256').update(body).digest('hex');
        await target.route(`**/data/${name}.json`, r => r.fulfill({ contentType: 'application/json', body }));
      }
      await target.route('**/data/manifest.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }));
      return target;
    }
    const changed = JSON.parse(readFileSync('public/data/validation.json'));
    changed.rows.find(r => r.validation_id === 'rate:within_fold:AUTOC:grf').estimate = 0.7;
    const bound = await intercepted({ validation: changed });
    await bound.goto(base + '/hte-validation');
    await bound.getByRole('table', { name: 'AUTOC estimates and intervals' }).waitFor();
    assert((await bound.locator('.hte-autoc tbody tr').first().innerText()).includes('0.7000'));
    await bound.close();
    const broken = await browser.newPage();
    await broken.route('**/data/validation.json', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
    await broken.goto(base + '/hte-validation'); await broken.getByRole('alert').waitFor();
    assert.equal(await broken.locator('main table').count(), 0); await broken.close();
    const missing = JSON.parse(readFileSync('public/data/validation.json'));
    missing.rows.find(r => r.metric === 'AUTOC').ci_lower = null;
    const unavailable = await intercepted({ validation: missing });
    await unavailable.goto(base + '/hte-validation'); await unavailable.getByRole('alert').waitFor();
    assert.equal(await unavailable.locator('main table').count(), 0); await unavailable.close();
    const schemas = JSON.parse(readFileSync('public/data/schemas.json'));
    schemas.$defs.validation.properties.rows.minItems = 0; schemas.$defs.subgroups.properties.rows.minItems = 0;
    const empty = await intercepted({ schemas, validation: { schema_name: 'validation', schema_version: '1.0.0', rows: [] }, subgroups: { schema_name: 'subgroups', schema_version: '1.0.0', rows: [] } });
    await empty.goto(base + '/hte-validation'); await empty.getByRole('status').filter({ hasText: 'No frozen HTE evidence available.' }).waitFor();
    assert.equal(await empty.locator('main table').count(), 0); await empty.close();
    const loading = await browser.newPage();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await loading.route('**/data/validation.json', async r => { await hold; await r.continue(); });
    await loading.goto(base + '/hte-validation'); await loading.getByRole('status').filter({ hasText: 'Loading frozen HTE evidence…' }).waitFor();
    assert.equal(await loading.locator('main table').count(), 0);
    release(); await loading.getByRole('table', { name: 'Adjusted classical subgroup effects' }).waitFor(); await loading.close();
    console.log(JSON.stringify({ status: 'PASS', autoc: 4, calibration: 2, participantAgreement: 3, subgroups: 13, widths: 4, noSelectors: true, exactSourceBindings: true, fixedScales: true, hoverAndFocusDetail: true, history: true, errorEmptyLoading: true, initialRenderMs, browser: await browser.version() }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
