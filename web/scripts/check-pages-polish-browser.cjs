const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = resolve('../reports/figures/web/pages_2_3_exact_orange_text_qa_20261003');
const referenceOrange = JSON.parse(readFileSync('../powerbi/report_theme.json')).dataColors[2];
assert.equal(referenceOrange, JSON.parse(readFileSync('../powerbi/Cardiovascular_Intervention_Targeting.Report/StaticResources/RegisteredResources/Cardiovascular_Intervention_Ta-a731d902.json')).dataColors[2]);
mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 990 }, reducedMotion: 'reduce' });
    const measurements = [];
    for (const route of ['overview', 'risk-vs-benefit', 'hte-validation']) {
      await page.goto(`${base}/${route}`);
      await page.locator('.overview-kpis, .risk-kpis, .hte-top').waitFor();
      for (const [width, height] of [[1920, 990], [1920, 900], [1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(150);
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, content: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth }));
        measurements.push({ route, ...size });
        assert(!size.overflow, `${route}: horizontal page overflow ${width}`);
        if (width === 1920 && height >= 990) assert(size.content <= height, `${route}: default desktop content ${size.content} exceeds ${height}`);
        if (route === 'hte-validation') {
          if (width === 390) assert(await page.locator('.autoc-table tbody tr').evaluateAll(rows => rows.every(row => {
            const label = row.querySelector('th > span'), range = document.createRange();
            range.selectNodeContents(label.lastChild);
            return [...range.getClientRects()].every(r => r.right <= row.querySelector('.hte-estimate').getBoundingClientRect().left - 5);
          })), 'Narrow policy names remain separate from estimate values');
          assert(await page.locator('.calibration-table tbody tr').evaluateAll(rows => rows.every(row => {
            const label = row.querySelector('svg text').getBoundingClientRect();
            const ref = row.querySelector('.interval-reference').getBoundingClientRect();
            const marker = row.querySelector('circle').getBoundingClientRect();
            return label.right < ref.left - 2 && label.bottom < marker.top && label.right <= marker.left;
          })), `Calibration label separation ${width}`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: resolve(output, `${route}-${width}x${height}.png`), fullPage: false });
        if (width !== 1920) await page.screenshot({ path: resolve(output, `${route}-${width}-full.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1920, height: 990 });
    await page.goto(base + '/risk-vs-benefit'); await page.locator('.risk-kpis').waitFor();
    assert(await page.locator('.risk-range').evaluate(n => {
      const s = getComputedStyle(n), [r, g, b] = s.color.match(/\d+/g).map(Number);
      return r > g && g > b && b === 0 && s.webkitTextStrokeWidth === '0px' && s.textShadow === 'none';
    }), 'Risk KPI retains solid orange, not navy');
    assert(await page.locator('.risk-range, .policy-name-baseline_risk').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).color === 'rgb(242, 140, 0)')), 'Page-2 Baseline Risk text and KPI use exact Power BI orange');
    assert.equal(await page.locator('.risk-kpis dt .policy-symbol').count(), 0, 'No extra baseline-risk dot');
    assert(await page.locator('.risk-agreement tbody tr').evaluateAll(rows => rows.every(row => {
      const dots = [...row.querySelectorAll('.pair-symbols > span')];
      const labels = [...row.querySelectorAll('th > [class^="policy-name-"]')];
      return dots.every((dot, index) => getComputedStyle(dot).color === (labels[index].classList.contains('policy-name-baseline_risk') ? 'rgb(242, 140, 0)' : getComputedStyle(labels[index]).color));
    })), 'Page-2 Baseline Risk dots are canonical; other policy dots stay unchanged');
    await page.locator('.risk-kpis .kpi').nth(1).screenshot({ path: resolve(output, 'risk-kpi.png') });
    assert(await page.locator('.risk-range').evaluate(n => {
      const v = getComputedStyle(n).color.match(/\d+/g).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
      const ratio = 1.05 / (.2126 * v[0] + .7152 * v[1] + .0722 * v[2] + .05);
      return ratio > 2.46 && ratio < 2.47;
    }), 'Exact orange contrast is a documented user-accepted limitation, not an accessibility PASS');
    const chart = page.locator('[data-chart="risk-benefit"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 1920, height: 990 });
    await page.waitForTimeout(150);
    assert((await chart.locator('svg').textContent()).includes('Village mean baseline predicted 10-year ASCVD risk (%)'), 'Desktop axis wording restores after mobile resize');
    assert.equal(Math.round((await chart.locator('svg path[fill="#0B2E83"]').first().boundingBox()).width), 13, 'Desktop dot size restores after mobile resize');
    const chartHeight = (await chart.boundingBox()).height;
    const summary = page.locator('.risk-point-values summary');
    await summary.click();
    const table = page.getByRole('table', { name: 'Selected village signal values' });
    assert.equal(await table.locator('tbody tr').count(), 127);
    assert(await table.evaluate(table => {
      const cells = [...table.querySelectorAll('thead th')];
      return cells.every((cell, i) => getComputedStyle(cell).textAlign === (i ? 'right' : 'left'))
        && [...table.querySelectorAll('tbody tr')].every(row => [...row.children].every((cell, i) => getComputedStyle(cell).textAlign === (i ? 'right' : 'left')));
    }), 'Headers align with their values');
    const region = page.locator('.risk-value-scroll');
    assert.equal(await region.evaluate(n => getComputedStyle(n).scrollbarGutter), 'stable');
    assert(await region.evaluate(n => n.scrollWidth <= n.clientWidth + 1));
    await region.focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => { const n = document.querySelector('.risk-value-scroll'); return n.scrollTop >= n.scrollHeight - n.clientHeight - 1; });
    assert.equal(await table.locator('tbody th').last().innerText(), '127');
    await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    assert(await chart.evaluate(host => {
      const box = host.getBoundingClientRect();
      return [...host.querySelectorAll('svg text')].every(n => { const r = n.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.left >= box.left - 1 && r.right <= box.right + 1; });
    }), 'Selected-signal axis labels fit the compact desktop chart');
    assert(await page.locator('.risk-point-values').evaluate(n => n.open));
    assert.equal(await table.locator('thead th').last().innerText(), 'Simple HTE benefit (pp)');
    assert.equal((await chart.boundingBox()).height, chartHeight, 'Expanded disclosure does not shrink plot');
    await region.evaluate(n => { n.scrollTop = 0; });
    await page.locator('.risk-point-values').screenshot({ path: resolve(output, 'risk-benefit-explore-expanded.png') });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await summary.click();
    assert.equal(await page.locator(':focus').innerText(), 'Explore village values');
    assert(await summary.evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
    assert.equal(new URL(page.url()).search, '?signal=simple');
    await page.screenshot({ path: resolve(output, 'risk-benefit-simple-1920x990.png'), fullPage: false });
    await page.goto(base + '/hte-validation'); await page.locator('.hte-autoc tbody').waitFor();
    assert(await page.locator('.hte-method-baseline_risk, .policy-name-baseline_risk').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).color === 'rgb(242, 140, 0)')), 'Page-3 Baseline Risk text uses exact Power BI orange');
    assert(await page.locator('.hte-method-simple, .policy-name-simple, .policy-name-grf').evaluateAll(nodes => nodes.every(n => {
      const rgb = getComputedStyle(n).color.match(/\d+/g).map(Number);
      const lum = v => v.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
      let parent = n, background;
      while (parent) { background = getComputedStyle(parent).backgroundColor; if (!background.includes('rgba')) break; parent = parent.parentElement; }
      return rgb.join(',') !== '8,27,75' && (lum(background.match(/\d+/g).slice(0, 3).map(Number)) + .05) / (lum(rgb) + .05) >= 4.5;
    })), 'Other policy text retains its rendered-background contrast checks');
    assert.equal(await page.locator('main svg title').count(), 0, 'No duplicate black native tooltips');
    assert(await page.locator('.hte-agreement-table tbody tr').evaluateAll(rows => rows.every(row => {
      const dots = [...row.querySelectorAll('.pair-symbols i')];
      const labels = [...row.querySelectorAll('[class^="policy-name-"]:not(i)')];
      return dots.every((dot, index) => getComputedStyle(dot).backgroundColor === (labels[index].classList.contains('policy-name-baseline_risk') ? 'rgb(242, 140, 0)' : getComputedStyle(labels[index]).color));
    })), 'Page-3 Baseline Risk dots are canonical; other policy dots stay unchanged');
    assert(await page.locator('.hte-method-symbol').evaluateAll(dots => dots.every(dot =>
      getComputedStyle(dot).backgroundColor === (dot.parentElement.classList.contains('hte-method-baseline_risk') ? 'rgb(242, 140, 0)' : getComputedStyle(dot.parentElement).color)
    )), 'Method Baseline Risk dots use the canonical policy token, not a text-color exception');
    assert(await page.locator('.hte-autoc tbody tr').nth(2).locator('svg').evaluate((svg, reference) =>
      [...svg.querySelectorAll('.interval-line, circle')].every(mark => getComputedStyle(mark).stroke.toUpperCase() === 'RGB(242, 140, 0)' && mark.getAttribute('stroke').toUpperCase() === reference)
    , referenceOrange), 'Actual Baseline Risk chart line/marker strokes reconcile to the frozen theme');
    const detailSizes = [];
    for (const selector of ['.hte-autoc tbody tr', '.hte-calibration tbody tr', '.hte-forest tbody tr', '.hte-evidence-status.comparative']) {
      const trigger = page.locator(selector).first();
      await trigger.focus();
      const detail = trigger.locator('.hte-detail');
      await detail.waitFor({ state: 'visible' });
      assert(await detail.locator('dl').count(), 'Structured label/value rows');
      assert(await detail.locator('dl > div').count() <= 3, 'Essential tooltip fields only');
      assert((await detail.boundingBox()).height <= 160, 'Compact desktop tooltip footprint');
      detailSizes.push({ panel: selector, box: await detail.boundingBox(), fields: await detail.locator('dl > div').count() });
      if (selector !== '.hte-evidence-status.comparative') {
        assert(await detail.evaluate(n => {
          const r = n.getBoundingClientRect();
          return [...n.closest('.panel').querySelectorAll('.interval-line, .interval-reference, .hte-interval circle, .hte-axis')].every(mark => {
            const s = mark.getBoundingClientRect();
            return r.right <= s.left || r.left >= s.right || r.bottom <= s.top || r.top >= s.bottom;
          });
        }), 'Tooltip avoids active and neighbouring intervals in its panel');
        if (selector !== '.hte-forest tbody tr') assert(await detail.evaluate(n => {
          const r = n.getBoundingClientRect();
          return [...n.closest('table').querySelectorAll('tbody tr')].every(row => [...row.cells].filter(cell => !cell.querySelector('svg')).every(cell => {
            const range = document.createRange(); range.selectNodeContents(cell);
            return [...range.getClientRects()].every(t => !t.width || r.right <= t.left || r.left >= t.right || r.bottom <= t.top || r.top >= t.bottom);
          }));
        }), 'Tooltip leaves policy names, estimates and subgroup CI text unobscured');
      } else {
        assert.equal((await detail.innerText()).toLowerCase().match(/not demonstrated/g)?.length, 1, 'Comparative finding stated once');
        assert((await detail.boundingBox()).y >= (await page.locator('.hte-evidence-status.support').boundingBox()).y + (await page.locator('.hte-evidence-status.support').boundingBox()).height, 'Comparative tooltip does not obscure the supported prioritization finding');
      }
      if (selector === '.hte-autoc tbody tr') await page.screenshot({ path: resolve(output, 'hte-validation-autoc-detail.png'), fullPage: false });
      if (selector === '.hte-autoc tbody tr') await detail.screenshot({ path: resolve(output, 'hte-autoc-tooltip.png') });
      if (selector === '.hte-calibration tbody tr') await page.screenshot({ path: resolve(output, 'hte-validation-calibration-detail.png'), fullPage: false });
      if (selector === '.hte-evidence-status.comparative') await page.screenshot({ path: resolve(output, 'hte-validation-comparative-detail.png'), fullPage: false });
      if (selector === '.hte-evidence-status.comparative') await detail.screenshot({ path: resolve(output, 'hte-comparative-tooltip.png') });
      assert(await detail.evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8; }), 'Tooltip bounded to viewport');
      await detail.hover(); assert(await detail.isVisible(), 'Tooltip hoverable');
      const focus = await page.locator(':focus').getAttribute('aria-label');
      await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' });
      assert.equal(await page.locator(':focus').getAttribute('aria-label'), focus, 'Escape preserves focus');
      await page.mouse.move(0, 0); await page.locator('h1').focus();
    }
    for (const [width, height] of [[1920, 990], [1366, 768]]) {
      await page.setViewportSize({ width, height });
      for (const selector of ['.autoc-table tbody tr', '.calibration-table tbody tr', '.hte-forest-table tbody tr']) {
        const rows = page.locator(selector);
        for (let index = 0; index < await rows.count(); index++) for (const mode of ['focus', 'hover']) {
          await page.keyboard.press('Escape'); await page.mouse.move(0, 0);
          await page.locator('h1').focus();
          const row = rows.nth(index); await row.scrollIntoViewIfNeeded();
          if (mode === 'focus') await row.focus(); else await row.hover();
          await page.waitForTimeout(40);
          assert(await row.locator('.hte-detail').isVisible(), `${selector} row ${index}: ${mode} detail remains visible`);
          assert((await row.locator('.hte-detail').boundingBox()).width >= 168, `${selector} row ${index}: readable ${mode} detail width`);
          assert(await row.locator('.hte-detail').evaluate(n => [...n.querySelectorAll('.hte-detail-title, dt, dd, .hte-detail-note')].every(field => {
            const range = document.createRange(); range.selectNodeContents(field);
            return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size <= 1;
          })), `${selector} row ${index}: desktop wording stays on one line per field`);
          if (selector === '.hte-forest-table tbody tr') assert(await row.locator('.hte-detail').evaluate(n => {
            const box = n.getBoundingClientRect(), row = n.closest('tr').getBoundingClientRect(), body = n.closest('tbody').getBoundingClientRect();
            return box.top >= Math.min(body.top, innerHeight - box.height - 8) && box.bottom <= body.bottom && Math.abs(box.top + box.height / 2 - row.top - row.height / 2) <= box.height / 2 + 8;
          }), `Subgroup ${index}: nearby gap placement stays with its row at ${width}, except viewport-edge clamping`);
          assert(await row.locator('.hte-detail').evaluate((n, allowTextOverlap) => {
            const r = n.getBoundingClientRect(), clear = t => r.right <= t.left || r.left >= t.right || r.bottom <= t.top || r.top >= t.bottom;
            const table = n.closest('table');
            return (allowTextOverlap || [...table.querySelectorAll('tbody tr')].every(row => [...row.cells].filter(cell => !cell.querySelector('svg')).every(cell => {
              const range = document.createRange(); range.selectNodeContents(cell);
              return [...range.getClientRects()].every(t => !t.width || clear(t));
            }))) && [...table.querySelectorAll('.interval-line, .interval-reference, .hte-interval circle, .hte-axis')].every(mark => clear(mark.getBoundingClientRect()));
          }, selector === '.hte-forest-table tbody tr'), `${selector} row ${index}: ${mode} geometry remains unobscured at ${width}`);
        }
      }
    }
    await page.keyboard.press('Escape'); await page.mouse.move(0, 0); await page.locator('h1').focus();
    await page.setViewportSize({ width: 1920, height: 990 }); await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.hte-forest tbody tr').nth(6).hover();
    await page.waitForTimeout(100);
    assert((await page.locator('.hte-forest tbody tr').nth(6).locator('.hte-detail').boundingBox()).width >= 168, 'Dismiss/reveal and resize must not measure a hidden tooltip as zero width');
    await page.screenshot({ path: resolve(output, 'hte-education-tooltip.png'), fullPage: false });
    await page.keyboard.press('Escape'); await page.mouse.move(0, 0);
    await page.locator('.hte-forest tbody tr').last().click();
    await page.locator('.hte-forest tbody tr').last().locator('.hte-detail').waitFor({ state: 'visible' });
    assert(!(await page.locator('.hte-detail:visible').innerText()).includes('VERIFIED'));
    assert((await page.locator('.hte-detail:visible').innerText()).includes('Groups partially reconstructable'), 'Retain scientifically necessary subgroup qualification');
    await page.screenshot({ path: resolve(output, 'hte-validation-forest-detail.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.locator('.hte-autoc tbody tr').first().focus();
    await page.locator('.hte-forest tbody tr').nth(3).hover();
    assert.equal(await page.locator('.hte-detail:visible').count(), 1, 'Hover and keyboard focus do not create duplicate tooltips');
    await page.keyboard.press('Escape'); await page.locator('h1').focus(); await page.mouse.move(0, 0);
    await page.setViewportSize({ width: 960, height: 540 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.locator('.calibration-table .hte-interval text').evaluateAll(labels => labels.every(n => n.getBoundingClientRect().right < n.closest('svg').querySelector('.interval-reference').getBoundingClientRect().left)));
    await page.locator('.hte-autoc tbody tr').first().focus();
    const enlargedDetail = page.locator('.hte-autoc tbody tr').first().locator('.hte-detail');
    await enlargedDetail.waitFor({ state: 'visible' });
    await enlargedDetail.evaluate(n => { n.scrollTop = n.scrollHeight; n.dispatchEvent(new Event('scroll')); });
    assert(await enlargedDetail.isVisible(), 'Internal tooltip scrolling must not dismiss detail');
    await page.keyboard.press('Escape');
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await touch.goto(base + '/hte-validation');
    const touchRow = touch.locator('.hte-autoc tbody tr').first();
    await touchRow.tap();
    await touchRow.locator('.hte-detail').waitFor({ state: 'visible' });
    assert((await touchRow.getAttribute('aria-label')).includes('4,508'));
    assert(await touchRow.locator('.hte-detail').evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8 && n.scrollWidth <= n.clientWidth; }), 'Narrow tooltip fits without clipping');
    await touch.screenshot({ path: resolve(output, 'hte-validation-narrow-detail.png'), fullPage: false });
    await touch.locator('h1').tap();
    await touchRow.locator('.hte-detail').waitFor({ state: 'hidden' });
    await touch.close();
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 1920, height: 990 });
    for (const [route, chartId, color] of [['overview', 'overview-effect', '#0798A5'], ['risk-vs-benefit', 'risk-benefit', '#0B2E83']]) {
      await page.goto(`${base}/${route}`);
      const graphic = page.locator(`[data-chart="${chartId}"]`);
      await graphic.locator(`svg path[fill="${color}"]`).first().hover();
      await page.waitForTimeout(100);
      assert((await graphic.locator('svg').textContent()).includes(route === 'overview' ? 'Estimate:' : 'Village 1'));
      await graphic.locator('svg text').filter({ hasText: route === 'overview' ? 'Estimate:' : 'Village 1' }).first().hover();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      assert(!(await graphic.locator('svg').textContent()).includes(route === 'overview' ? 'Estimate:' : 'Village 1'), `Chart tooltip Escape dismissal: ${route}`);
      await page.mouse.move(0, 0);
    }
    console.log(JSON.stringify({ status: 'PASS', measurements, detailSizes, tableFlow: true, calibrationLabels: true, structuredDetails: true, tooltipInternalScroll: true, touchTapDetail: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
