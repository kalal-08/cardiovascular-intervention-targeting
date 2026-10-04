const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const read = name => JSON.parse(readFileSync(`public/data/${name}.json`)).rows;
const villages = read('villages'), anchors = read('anchors'), robustness = read('robustness'), coverage = read('coverage'), overlap = read('overlap');
const labels = { grf: 'GRF', simple: 'Simple HTE', baseline_risk: 'Baseline Risk' };
const first = { grf: ['66', '47', '55'], simple: ['33', '71', '47'], baseline_risk: ['106', '33', '47'] };
const last = { grf: '121', simple: '80', baseline_risk: '12' };
const dimensions = ['age', 'sex', 'income', 'education', 'occupation'];
const fields = { village: 'village_id', focus: 'simple_candidate_rank', grfRank: 'grf_candidate_rank', grfBenefit: 'grf_predicted_benefit', simpleRank: 'simple_candidate_rank', simpleBenefit: 'simple_predicted_benefit', baselineRank: 'baseline_risk_candidate_rank', baselineRisk: 'baseline_risk', participants: 'n_randomized' };
const saveCaptures = process.env.SAVE_CAPTURES !== '0';
const output = process.env.SAVE_REVIEW === '1' ? resolve('../reports/figures/web/phase12c9_page5_20261003') : resolve('.wrangler/qa/page5'); if (saveCaptures) mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 990 }, reducedMotion: 'reduce' });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.url().includes('/data/')) requests.push(request.url()); });
    await page.goto(base + '/robustness'); await page.locator('h1').waitFor();
    await page.locator('.p5-kpis').waitFor();
    for (const selector of ['.p5-overlap .p5-read', '.p5-interval-block .p5-read', '.p5-coverage .p5-read']) {
      const trigger = page.locator(selector).first(); await trigger.hover(); await page.locator('.p5-detail').waitFor();
      const target = await trigger.locator(selector.includes('interval') ? '.p5-estimate-marker' : '.p5-bar').boundingBox();
      const detail = await page.locator('.p5-detail').boundingBox();
      if (selector.includes('interval')) {
        assert(detail.x >= target.x + target.width + 8, 'The interval retains its approved right-side placement');
        assert(detail.y + detail.height <= target.y - 8, 'The interval detail stays fully above its marker and CI graphic');
        const classification = await page.locator('.p5-classification').boundingBox();
        assert(detail.y >= classification.y + classification.height + 4, 'The default interval detail fits the empty right-side gap without covering its classification');
      } else {
        assert(detail.y + detail.height <= target.y - 8 && Math.abs(detail.x + detail.width / 2 - target.x - target.width / 2) <= 1, 'Overlap and coverage details sit directly above their bar columns using the same centered placement rule');
      }
      await trigger.focus(); await page.keyboard.press('Escape'); await page.locator('h1').click(); await page.mouse.move(1, 1);
    }
    const presentation = await page.evaluate(() => {
      const overlap = document.querySelector('.p5-overlap .table-scroll'), coverage = document.querySelector('.p5-coverage .table-scroll');
      const header = document.querySelector('.p5-overlap thead th:nth-child(2)'), caption = header.querySelector('.p5-reference-caption');
      const range = document.createRange(); range.selectNodeContents(header.firstChild);
      return {
        smallGridsFullyVisible: [overlap, coverage].every(n => n.scrollHeight <= n.clientHeight),
        coverageHeaderCompact: coverage.querySelector('thead').getBoundingClientRect().height <= 46,
        overlapReferenceBelowLabel: caption.getBoundingClientRect().top >= range.getBoundingClientRect().bottom,
        selectorColors: [...document.querySelectorAll('.p5-controls fieldset:first-child button')].map(n => getComputedStyle(n.firstElementChild || n).color),
      };
    });
    assert.deepEqual(presentation, { smallGridsFullyVisible: true, coverageHeaderCompact: true, overlapReferenceBelowLabel: true,
      selectorColors: ['rgb(11, 46, 131)', 'rgb(6, 125, 136)', 'rgb(242, 140, 0)'] }, 'Compact grids must fit without internal vertical scrolling; overlap reference has its own line; policy selectors match Page 4');
    assert.equal(await page.locator('.p5-rankings tbody tr').count(), 127, 'Production Page 5 must render all 127 complete village rows, not the placeholder');
    const rankings = page.locator('.p5-rankings');
    const row71 = rankings.locator('tbody tr[data-village="71"]');
    const backgrounds = row => row.locator(':scope > *').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).backgroundColor));
    const beforeSelection = { url: page.url(), panels: await page.locator('.p5-right').innerText(), ids: await rankings.locator('tbody tr').evaluateAll(nodes => nodes.map(n => n.dataset.village)), background: await rankings.locator('tbody tr[data-village="71"] td').last().evaluate(n => getComputedStyle(n).backgroundColor) };
    const restingRow = await backgrounds(row71);
    await row71.locator('td').last().hover();
    assert.equal(await row71.evaluate(n => getComputedStyle(n).cursor), 'default', 'Village rows use the normal arrow cursor');
    assert.equal(await row71.locator('button').evaluate(n => getComputedStyle(n).cursor), 'default', 'Village ID buttons retain keyboard access without a hand cursor');
    const hoveredRow = await backgrounds(row71);
    assert.notDeepEqual(hoveredRow, restingRow, 'Hover visibly highlights the whole row');
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 0, 'Hover must not select a row');
    assert.equal(await row71.locator('button').getAttribute('aria-pressed'), 'false');
    assert.equal(page.url(), beforeSelection.url); assert.equal(await page.locator('.p5-right').innerText(), beforeSelection.panels);
    await page.mouse.move(1, 1); assert.deepEqual(await backgrounds(row71), restingRow, 'Leaving restores the existing column/striped backgrounds');
    await rankings.locator('tbody tr[data-village="71"] td').last().click();
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 1, 'Clicking a village row exposes exactly one selected row');
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').getAttribute('data-village'), '71', 'Clicking any cell selects one complete village row');
    assert.notEqual(await rankings.locator('tbody tr[data-village="71"] td').last().evaluate(n => getComputedStyle(n).backgroundColor), beforeSelection.background, 'Selection is visibly highlighted, not merely an attribute');
    const selectedRow = await backgrounds(row71);
    assert.notDeepEqual(selectedRow, hoveredRow, 'Selected and hovered rows are visually distinct');
    await page.mouse.move(1, 1); assert.deepEqual(await backgrounds(row71), selectedRow, 'Selection persists after pointer departure');
    await rankings.locator('tbody tr[data-village="33"] td').first().hover();
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').getAttribute('data-village'), '71', 'Hovering another row does not switch selection');
    assert.deepEqual(await backgrounds(row71), selectedRow);
    await row71.locator('button').hover(); assert.deepEqual(await backgrounds(row71), selectedRow, 'Hover does not replace the selected-row styling');
    assert.equal(await row71.locator('button').evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)', 'No separate button-hover patch covers the row highlight');
    if (saveCaptures) await page.locator('.p5-ranking-panel').screenshot({ path: resolve(output, 'page5-row-selected.png') });
    assert.equal(page.url(), beforeSelection.url); assert.equal(await page.locator('.p5-right').innerText(), beforeSelection.panels);
    assert.deepEqual(await rankings.locator('tbody tr').evaluateAll(nodes => nodes.map(n => n.dataset.village)), beforeSelection.ids);
    await rankings.locator('tbody tr[data-village="33"] td').first().click();
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 1);
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').getAttribute('data-village'), '33');
    assert.equal(await row71.locator('button').getAttribute('aria-pressed'), 'false', 'Selecting another village clears the previous selection');
    await rankings.locator('tbody tr[data-village="33"] td').first().click(); assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 0);
    const villageButton = rankings.getByRole('button', { name: 'Select village 71', exact: true });
    await villageButton.focus(); await page.keyboard.press('Enter');
    assert.equal(await villageButton.getAttribute('aria-pressed'), 'true');
    await rankings.locator('[data-sort="participants"]').click(); await page.getByRole('button', { name: 'GRF', exact: true }).click();
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').getAttribute('data-village'), '71', 'Selection stays attached to Village ID through sorting and policy changes');
    await page.getByRole('button', { name: '32 villages', exact: true }).click(); await page.locator('.p5-coverage select').selectOption('occupation');
    assert.equal(await rankings.locator('tbody tr[data-selected="true"]').getAttribute('data-village'), '71', 'Capacity/dimension changes preserve Village-ID selection');
    await page.getByRole('button', { name: '64 villages', exact: true }).click(); await page.locator('.p5-coverage select').selectOption('age');
    await villageButton.focus(); await page.keyboard.press('Escape'); assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 0);
    await page.keyboard.press('Space'); assert.equal(await villageButton.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Space'); assert.equal(await villageButton.getAttribute('aria-pressed'), 'false');
    await rankings.locator('[data-sort="focus"]').click(); await page.getByRole('button', { name: 'Simple HTE', exact: true }).click();
    const rows = () => rankings.locator('tbody tr').evaluateAll(nodes => nodes.map(row => ({ id: row.dataset.village, cells: [...row.children].map(c => c.textContent.trim()) })));
    const fixedCells = row => [row.village_id, String(row.grf_candidate_rank), row.grf_predicted_benefit.toFixed(3), String(row.simple_candidate_rank), row.simple_predicted_benefit.toFixed(3), String(row.baseline_risk_candidate_rank), row.baseline_risk.toFixed(2), String(row.n_randomized)];
    async function verify(policy, k, dimension) {
      assert.deepEqual(await page.locator('.p5-kpis dd').allTextContents(), ['127', '42.2%', '12 of 12', '3']);
      const actual = await rows(); assert.equal(actual.length, 127); assert.equal(new Set(actual.map(r => r.id)).size, 127);
      for (const row of actual) {
        const source = villages.find(v => v.village_id === row.id);
        assert.deepEqual([row.cells[0], ...row.cells.slice(2)], fixedCells(source));
        assert.equal(row.cells[1], String(source[`${policy}_candidate_rank`]));
      }
      assert.equal(await rankings.locator('thead [data-policy].selected-policy').getAttribute('data-policy'), policy);
      const anchor = anchors.find(r => r.policy === policy && r.capacity_villages === k);
      assert.equal(await page.locator('.p5-covered').innerText(), `Covered: ${anchor.n_selected_randomized.toLocaleString('en-US')} / 4,533`);
      const dim = coverage.filter(r => r.policy === policy && r.capacity_villages === k && r.dimension === dimension).sort((a, b) => a.category.localeCompare(b.category, 'en', { sensitivity: 'variant' }));
      assert.equal(await page.locator('.p5-coverage select').inputValue(), dimension);
      assert((await page.locator('.p5-coverage h2').innerText()).includes(dimension === 'income' ? 'Income' : dim[0].dimension_label));
      const cells = await page.locator('.p5-coverage tbody tr').evaluateAll(nodes => nodes.map(n => [...n.children].map(c => c.textContent.trim())));
      assert.equal(cells.length, 2);
      for (let i = 0; i < 2; i++) {
        assert(cells[i][0].length > 0);
        assert.equal(cells[i][2], `${(dim[i].subgroup_coverage * 100).toFixed(1)}%`);
        assert.equal(cells[i][3], `${dim[i].n_subgroup_covered.toLocaleString('en-US')} / ${dim[i].n_subgroup_total.toLocaleString('en-US')}`);
        assert.equal(cells[i][4], `${dim[i].coverage_gap > 0 ? '+' : ''}${(dim[i].coverage_gap * 100).toFixed(1)} pp`);
        assert(Math.abs(parseFloat(await page.locator('.p5-coverage .p5-bar-fill').nth(i).getAttribute('data-value')) - dim[i].subgroup_coverage) < 1e-12);
      }
      assert.equal(await page.locator('.p5-overall-label').innerText(), `Overall ${(anchor.randomized_coverage * 100).toFixed(1)}%`);
      const references = await page.evaluate(() => {
        const header = document.querySelector('.p5-overall-header');
        return [header.getBoundingClientRect().x + parseFloat(getComputedStyle(header, '::before').left), ...[...document.querySelectorAll('.p5-coverage .p5-bar-reference')].map(n => n.getBoundingClientRect().x)];
      });
      assert(references.every(x => Math.abs(x - references[0]) <= 1), 'Overall header reference aligns with both bars');
      assert(await page.locator('.p5-overlap .table-scroll, .p5-coverage .table-scroll').evaluateAll(nodes => nodes.every(n => n.scrollHeight <= n.clientHeight)), 'All small-grid rows fit vertically in every selector state');
      const pairs = overlap.filter(r => r.capacity_villages === k).sort((a, b) => ['grf|simple', 'grf|baseline_risk', 'simple|baseline_risk'].indexOf(`${a.policy_left}|${a.policy_right}`) - ['grf|simple', 'grf|baseline_risk', 'simple|baseline_risk'].indexOf(`${b.policy_left}|${b.policy_right}`));
      assert.equal(await page.locator('.p5-overlap tbody tr').count(), 3);
      assert.deepEqual(await page.locator('.p5-overlap tbody tr').evaluateAll(nodes => nodes.map(n => [...n.children].slice(2).map(c => c.textContent.trim()))), pairs.map(r => [`${(r.jaccard_overlap * 100).toFixed(1)}%`, String(r.shared_villages)]));
      if (k === 127) {
        assert.equal(await page.locator('.p5-reconciliation').innerText(), 'Not applicable — full-capacity reconciliation');
        assert.equal(await page.locator('.p5-interval, .p5-findings, .p5-estimate').count(), 0);
      } else {
        const r = robustness.find(r => r.policy === policy && r.capacity_villages === k);
        assert.equal(await page.locator('.p5-estimate').innerText(), `${r.phase11a_point_gain_vs_random > 0 ? '+' : ''}${r.phase11a_point_gain_vs_random.toFixed(4)} pp`);
        assert((await page.locator('.p5-ci').innerText()).includes(`${r.phase11a_gain_ci_lower.toFixed(4)} to ${r.phase11a_gain_ci_upper.toFixed(4)}`));
        assert.equal(await page.locator('.p5-findings tbody tr').count(), 3);
        assert.equal(await page.locator('.p5-findings tbody tr').last().locator('td').first().innerText(), r.single_village_influence === 'ROBUST TO SINGLE-VILLAGE DELETION' ? 'Robust' : 'Sensitive');
      }
      return actual.map(r => r.id);
    }
    await verify('simple', 64, 'age');
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(['grf', 'simple', 'baseline_risk'].map(policy => [policy, {
      text: getComputedStyle(document.querySelector(`.p5 .policy-name-${policy}`)).color,
      symbol: getComputedStyle(document.querySelector(`.p5-symbol-${policy}`)).color,
    }]))), { grf: { text: 'rgb(11, 46, 131)', symbol: 'rgb(11, 46, 131)' }, simple: { text: 'rgb(6, 125, 136)', symbol: 'rgb(6, 125, 136)' }, baseline_risk: { text: 'rgb(242, 140, 0)', symbol: 'rgb(242, 140, 0)' } });
    assert.equal(await rankings.locator('thead tr').count(), 2);
    assert.equal(await rankings.locator('[aria-sort]').count(), 1);
    const requestCount = requests.length;
    let states = 0;
    for (const policy of Object.keys(labels)) {
      await page.getByRole('button', { name: labels[policy], exact: true }).click();
      assert.deepEqual((await rows()).slice(0, 3).map(r => r.id), first[policy]);
      for (const k of [13, 32, 64, 95, 127]) {
        await page.getByRole('button', { name: `${k} villages`, exact: true }).click();
        const order = (await rows()).map(r => r.id);
        for (const dimension of dimensions) {
          await page.locator('.p5-coverage select').selectOption(dimension);
          assert.deepEqual(await verify(policy, k, dimension), order); states++;
        }
      }
      const scroll = page.locator('.p5-rank-scroll');
      await scroll.evaluate(n => { n.scrollTop = n.scrollHeight; });
      assert.equal((await rows()).at(-1).id, last[policy]);
      const final = await rankings.locator('tbody tr').last().boundingBox(), bounds = await scroll.boundingBox();
      assert(final.y >= bounds.y && final.y + final.height <= bounds.y + bounds.height + 1, 'Final village is visibly reachable');
    }
    assert.equal(requests.length, requestCount, 'Selectors do not refetch frozen data');
    await page.goto(base + '/robustness'); await page.locator('.p5-kpis').waitFor();
    let currentOrder = villages.map(v => v.village_id).sort((a, b) => villages.find(r => r.village_id === a).simple_candidate_rank - villages.find(r => r.village_id === b).simple_candidate_rank);
    let sortCases = 0;
    for (const [field, property] of Object.entries(fields)) for (const direction of ['asc', 'desc']) {
      const button = rankings.locator(`[data-sort="${field}"]`);
      await button.click();
      if (await button.locator('..').getAttribute('aria-sort') !== (direction === 'asc' ? 'ascending' : 'descending')) await button.click();
      const values = Object.fromEntries(villages.map(r => [r.village_id, Number(r[property])]));
      currentOrder.sort((a, b) => (values[a] - values[b]) * (direction === 'asc' ? 1 : -1));
      assert.deepEqual((await rows()).map(r => r.id), currentOrder);
      assert.equal(await rankings.locator('[aria-sort]').count(), 1);
      for (const policy of ['grf', 'baseline_risk', 'simple']) {
        await page.getByRole('button', { name: labels[policy], exact: true }).click();
        if (field === 'focus') currentOrder.sort((a, b) => (villages.find(r => r.village_id === a)[`${policy}_candidate_rank`] - villages.find(r => r.village_id === b)[`${policy}_candidate_rank`]) * (direction === 'asc' ? 1 : -1));
        assert.deepEqual(await verify(policy, 64, 'age'), currentOrder);
        assert.equal(await button.locator('..').getAttribute('aria-sort'), direction === 'asc' ? 'ascending' : 'descending');
      }
      sortCases++;
    }
    await page.goto(base + '/robustness'); await page.locator('.p5-kpis').waitFor(); await page.mouse.move(1, 1);
    await verify('simple', 64, 'age');
    const timings = {};
    for (const [name, ready] of [
      ['policy', () => page.waitForFunction(() => document.querySelector('.p5-rankings tbody tr').dataset.village === '66')],
      ['capacity', () => page.waitForFunction(() => document.querySelector('.p5-overlap h2').textContent.endsWith('32'))],
      ['dimension', () => page.waitForFunction(() => document.querySelector('.p5-coverage h2').textContent.endsWith('Occupation'))],
      ['sort', () => page.waitForFunction(() => document.querySelector('.p5-rankings [aria-sort]').getAttribute('aria-sort') === 'descending')],
    ]) {
      // Measure native action through two rendered frames, separately from assertion/driver overhead.
      timings[name] = await page.evaluate(name => new Promise(resolve => {
        const start = performance.now();
        if (name === 'policy') document.querySelector('.p5-controls button').click();
        else if (name === 'capacity') document.querySelectorAll('.p5-controls fieldset')[1].querySelectorAll('button')[1].click();
        else if (name === 'dimension') { const n = document.querySelector('.p5-coverage select'); n.value = 'occupation'; n.dispatchEvent(new Event('change', { bubbles: true })); }
        else document.querySelector('[data-sort=focus]').click();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round((performance.now() - start) * 10) / 10)));
      }), name);
      await ready();
    }
    const selectedURL = page.url();
    assert(selectedURL.endsWith('/robustness?policy=grf&k=32&dimension=occupation&direction=desc'));
    await page.reload(); await page.locator('.p5-kpis').waitFor(); await verify('grf', 32, 'occupation');
    assert.equal((await rows())[0].id, last.grf);
    await page.locator('.p5-coverage select').selectOption('sex'); await verify('grf', 32, 'sex');
    await page.goBack(); await verify('grf', 32, 'occupation'); await page.goForward(); await verify('grf', 32, 'sex');
    await page.getByRole('link', { name: 'Overview', exact: true }).click(); await page.getByRole('heading', { name: 'Trial Evidence Overview' }).waitFor();
    assert(new URL(page.url()).pathname === '/overview' && !new URL(page.url()).search);
    await page.getByRole('link', { name: 'Robustness', exact: true }).click(); await page.locator('.p5-kpis').waitFor(); await verify('grf', 32, 'sex');
    await page.goto(base + '/robustness?policy=grf&k=bad&dimension=occupation&sort=participants&direction=wrong&private=denied'); await page.locator('.p5-kpis').waitFor();
    await verify('grf', 64, 'occupation'); assert((await page.locator('.status-notice').innerText()).includes('k, direction'));
    assert(!page.url().includes('private') && !page.url().includes('bad') && !page.url().includes('wrong'));
    await page.goto(base + '/robustness'); await page.locator('.p5-kpis').waitFor(); await verify('simple', 64, 'age');
    await page.getByRole('button', { name: 'GRF', exact: true }).focus(); await page.keyboard.press('Enter'); await verify('grf', 64, 'age');
    await rankings.locator('[data-sort="focus"]').focus(); await page.keyboard.press('Space'); assert.equal((await rows())[0].id, last.grf);
    const scroll = page.locator('.p5-rank-scroll'); await scroll.focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => { const n = document.querySelector('.p5-rank-scroll'); return n.scrollTop > 0; });
    await scroll.evaluate(n => { n.scrollTop = n.scrollHeight; });
    const fixedHeader = await rankings.locator('thead').boundingBox(), scrollBox = await scroll.boundingBox();
    assert(Math.abs(fixedHeader.y - scrollBox.y) < 3, 'Both header tiers stay fixed while the native body scrolls');
    await page.goto(base + '/robustness'); await page.locator('.p5-kpis').waitFor();
    const details = [...await page.locator('.p5-overlap .p5-read').all(), page.locator('.p5-interval-block .p5-read'), ...await page.locator('.p5-coverage .p5-read').all()];
    for (const [index, locator] of details.entries()) {
      await locator.hover(); await page.locator('.p5-detail').waitFor();
      assert.equal(await page.locator('.p5-detail').count(), 1);
      const detailText = await page.locator('.p5-detail').innerText();
      const tip = await page.locator('.p5-detail').boundingBox(); assert(tip.x >= 0 && tip.y >= 0 && tip.x + tip.width <= 1920 && tip.y + tip.height <= 990);
      await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2, { steps: 20 });
      await page.waitForTimeout(180); assert.equal(await page.locator('.p5-detail').count(), 1, 'Pointer can enter and read the detail');
      assert.equal(await page.locator('.p5-detail').innerText(), detailText, 'Pointer entry must retain the inspected row, not switch to a crossed neighbour');
      // Full-page capture resizes the viewport and correctly dismisses transient details.
      if (saveCaptures && (index === 0 || index >= 3)) await page.screenshot({ path: resolve(output, `page5-detail-${index === 0 ? 'overlap' : index === 3 ? 'interval' : index === 4 ? 'first-group' : 'final-group'}.png`) });
      assert.equal(await page.locator('.p5-detail').count(), 1);
      await locator.focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('.p5-detail').count(), 0);
      await page.locator('h1').click();
      await locator.hover(); await page.mouse.move(1, 1); await locator.focus();
      await page.waitForTimeout(180); assert.equal(await page.locator('.p5-detail').count(), 1, 'Keyboard focus cancels pending pointer dismissal');
      await page.keyboard.press('Escape'); await page.locator('h1').click();
    }
    await page.locator('.p5-overlap .p5-read').first().focus(); await page.locator('.p5-overlap .p5-read').last().hover();
    assert.equal(await page.locator('.p5-detail').count(), 1, 'Focus plus hover must not duplicate tooltips');
    assert.equal(await page.locator('.p5-detail').getAttribute('id'), await page.locator('.p5-overlap .p5-read').first().getAttribute('aria-describedby'), 'The focused detail retains ownership when the pointer uncovers another bar');
    await page.locator('h1').click(); await page.mouse.move(1, 1); await page.evaluate(() => scrollTo(0, 0));
    await page.setViewportSize({ width: 1920, height: 1080 });
    if (saveCaptures) await page.screenshot({ path: resolve(output, 'page5-default.png'), fullPage: true });
    if (saveCaptures) for (const panel of ['rankings', 'overlap', 'robustness', 'coverage']) await page.locator(panel === 'rankings' ? '.p5-ranking-panel' : `.p5-${panel}`).screenshot({ path: resolve(output, `page5-${panel}-close.png`) });
    for (const policy of ['grf', 'baseline_risk']) {
      await page.getByRole('button', { name: labels[policy], exact: true }).click(); await page.locator('.p5-coverage select').selectOption('occupation');
      if (saveCaptures) await page.screenshot({ path: resolve(output, `page5-${policy}-occupation.png`), fullPage: true });
    }
    await page.getByRole('button', { name: '127 villages', exact: true }).click(); if (saveCaptures) await page.screenshot({ path: resolve(output, 'page5-full-capacity.png'), fullPage: true });
    await page.goto(base + '/robustness'); await page.locator('.p5-kpis').waitFor();
    const layouts = [];
    for (const [width, height, font] of [[1920, 1080, 16], [1920, 990, 16], [1440, 900, 16], [1280, 800, 16], [768, 1024, 16], [390, 844, 16], [1920, 990, 20]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
      await page.locator('.p5-coverage select').selectOption('occupation');
      const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, tableScroll: document.querySelector('.p5-rank-scroll').scrollWidth > document.querySelector('.p5-rank-scroll').clientWidth + 1 }));
      assert(geometry.width <= width + 1, `No page horizontal overflow at ${width}/${font}`);
      assert(await page.locator('.p5-overlap .table-scroll, .p5-coverage .table-scroll').evaluateAll(nodes => nodes.every(n => n.scrollHeight <= n.clientHeight)), `Small grids have no internal vertical scroll at ${width}/${font}`);
      if (width === 1920 && font === 16) assert(!geometry.tableScroll, 'No desktop horizontal table scrolling');
      if (width === 1920 && height === 1080 && font === 16) assert(geometry.height <= height, 'Canonical desktop fits without clipping or shrinking text');
      const firstRow = rankings.locator('tbody tr').first();
      await firstRow.locator('button').hover();
      assert.equal(await firstRow.locator('button').evaluate(n => getComputedStyle(n).cursor), 'default');
      assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 0, `Hover does not select at ${width}/${font}`);
      await firstRow.locator('button').click(); assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 1);
      await firstRow.locator('button').click(); assert.equal(await rankings.locator('tbody tr[data-selected="true"]').count(), 0);
      await page.mouse.move(1, 1);
      if (saveCaptures) await page.screenshot({ path: resolve(output, `page5-${width}x${height}-${font}px.png`), fullPage: true }); layouts.push({ width, height, font, ...geometry });
      for (const trigger of await page.locator('.p5-overlap .p5-read, .p5-interval-block .p5-read, .p5-coverage .p5-read').all()) {
        await trigger.hover(); await page.locator('.p5-detail').waitFor();
        const detail = await page.locator('.p5-detail').boundingBox();
        assert(detail.x >= 0 && detail.y >= 0 && detail.x + detail.width <= width && detail.y + detail.height <= height, `Analytical detail stays inside viewport at ${width}/${font}`);
        await trigger.focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('.p5-detail').count(), 0);
        await page.locator('h1').click(); await page.mouse.move(1, 1);
      }
    }
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const mobile = await touch.newPage();
    await mobile.goto(base + '/robustness'); await mobile.locator('.p5-kpis').waitFor(); await mobile.locator('.p5-interval-block .p5-read').tap();
    await mobile.locator('.p5-detail').waitFor(); await mobile.locator('h1').tap(); assert.equal(await mobile.locator('.p5-detail').count(), 0);
    const touchVillage = mobile.getByRole('button', { name: 'Select village 33', exact: true });
    await touchVillage.tap(); assert.equal(await touchVillage.getAttribute('aria-pressed'), 'true');
    await touchVillage.tap(); assert.equal(await touchVillage.getAttribute('aria-pressed'), 'false'); await touch.close();
    const loading = await browser.newPage();
    await loading.route('**/data/coverage.json', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
    await loading.goto(base + '/robustness'); await loading.getByText('Loading frozen robustness evidence…', { exact: true }).waitFor(); await loading.locator('.p5-kpis').waitFor(); await loading.close();
    const failure = await browser.newPage();
    await failure.route('**/data/coverage.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"schema_version":"wrong","rows":[]}' }));
    await failure.goto(base + '/robustness'); await failure.getByText('Unable to load frozen robustness evidence.', { exact: true }).waitFor(); assert.equal(await failure.locator('.p5-kpis, .p5-panels').count(), 0); await failure.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', states, sortCases, completeRows: 127, sourceSignals: true, frozenKPIs: true, isolation: true, sortPersistence: true, history: true, keyboardTouch: true, rowPointerHover: true, capturesSaved: saveCaptures, loadingFailure: true, timings, layouts, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
