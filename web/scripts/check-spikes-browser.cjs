const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.argv[3] || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:5173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const data = Object.fromEntries(['villages', 'anchors', 'overlap', 'robustness', 'coverage'].map(name => [name, JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data', `${name}.json`))).rows]));
const byId = new Map(data.villages.map(row => [row.village_id, row]));
const policies = ['grf', 'simple', 'baseline_risk'], capacities = [13, 32, 64, 95, 127];
const dimensions = { age: 'Age', sex: 'Sex', income: 'Annual household income', education: 'Education', occupation: 'Occupation' };
const qa = path.join(__dirname, '../.wrangler/qa');
fs.mkdirSync(qa, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const errors = [], timings = [], dataRequests = [];
    let documents = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.resourceType() === 'document') documents++; if (request.url().includes('/data/')) dataRequests.push(request.url()); });
    const select = (label, value) => page.getByLabel(label, { exact: true }).selectOption(String(value));
    const ids = () => page.locator('[data-testid="rankings"] tbody tr').evaluateAll(rows => rows.map(row => row.dataset.village));
    const text = selector => page.locator(selector).innerText();
    const expectedCells = (row, policy) => [row.village_id, String(row[`${policy}_candidate_rank`]), String(row.grf_candidate_rank), row.grf_predicted_benefit.toFixed(3), String(row.simple_candidate_rank), row.simple_predicted_benefit.toFixed(3), String(row.baseline_risk_candidate_rank), row.baseline_risk.toFixed(2), String(row.n_randomized)];
    async function verifyRows(policy) {
      const cells = await page.locator('[data-testid="rankings"] tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.children, cell => cell.textContent)));
      assert.equal(cells.length, 127);
      for (const row of cells) assert.deepEqual(row, expectedCells(byId.get(row[0]), policy));
    }
    async function measure(label, value) {
      const ms = await page.evaluate(async ({ label, value }) => {
        const select = document.querySelector(`select[aria-label="${label}"]`);
        const start = performance.now(); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - start;
      }, { label, value: String(value) });
      timings.push({ control: label, ms: +ms.toFixed(1) });
    }
    await page.goto(`${base}/__spikes/page5`);
    await page.waitForSelector('[data-testid="rankings"]');
    const defaultIDs = await ids();
    assert.deepEqual(defaultIDs.slice(0, 3), ['33', '71', '47']);
    const frozen = await page.getByRole('definition').allTextContents();
    assert.deepEqual(frozen, ['127', '42.2%', '12 of 12', '3']);
    const initialDocuments = documents, initialRequests = dataRequests.length;
    for (const policy of policies) {
      await measure('Focused policy', policy);
      const ranked = [...data.villages].sort((a, b) => a[`${policy}_candidate_rank`] - b[`${policy}_candidate_rank`]).map(row => row.village_id);
      assert.deepEqual(await ids(), ranked);
      await verifyRows(policy);
      assert.equal(await page.locator('th.selected-policy').getAttribute('data-policy'), policy);
      for (const k of capacities) {
        await measure('Capacity anchor', k);
        const overlap = data.overlap.filter(row => row.capacity_villages === k);
        const shown = await text('[data-testid="overlap"]');
        for (const row of overlap) { assert(shown.includes(`${(row.jaccard_overlap * 100).toFixed(1)}%`)); assert(shown.includes(String(row.shared_villages))); }
        const robust = data.robustness.find(row => row.policy === policy && row.capacity_villages === k);
        if (k === 127) {
          assert.equal(await page.locator('[data-testid="robustness"]').count(), 0);
          assert.match(await text('[data-testid="reconciliation"]'), /Not applicable — full-capacity reconciliation/);
        } else {
          const shown = await text('[data-testid="robustness"]');
          for (const field of ['phase11a_point_gain_vs_random', 'phase11a_gain_ci_lower', 'phase11a_gain_ci_upper']) assert(shown.includes(robust[field].toFixed(4)));
          assert(shown.includes(robust.single_village_influence));
        }
        const overall = await text('[data-testid="overall"]');
        for (const [dimension, title] of Object.entries(dimensions)) {
          await select('Coverage dimension', dimension);
          assert.equal(await text('#coverage-title'), `Descriptive Coverage by ${title}`);
          assert.equal(await text('[data-testid="overall"]'), overall);
          assert.deepEqual(await ids(), ranked);
          assert.deepEqual(await page.getByRole('definition').allTextContents(), frozen);
          const expected = data.coverage.filter(row => row.policy === policy && row.capacity_villages === k && row.dimension === dimension);
          const shown = await text('[data-testid="coverage"]');
          for (const row of expected) {
            assert(shown.includes(row.category));
            assert(shown.includes(`${row.n_subgroup_covered.toLocaleString('en-US')} / ${row.n_subgroup_total.toLocaleString('en-US')}`));
            assert(shown.includes(`${(row.subgroup_coverage * 100).toFixed(1)}%`));
          }
        }
      }
    }
    const fields = { village: 'village_id', focus: 'baseline_risk_candidate_rank', grfRank: 'grf_candidate_rank', grfBenefit: 'grf_predicted_benefit', simpleRank: 'simple_candidate_rank', simpleBenefit: 'simple_predicted_benefit', baselineRank: 'baseline_risk_candidate_rank', baselineRisk: 'baseline_risk', participants: 'n_randomized' };
    for (const [sort, field] of Object.entries(fields)) for (let turn = 0; turn < 2; turn++) {
      const before = await ids();
      const button = page.locator(`[data-sort="${sort}"]`);
      const current = await button.locator('..').getAttribute('aria-sort');
      const direction = current === 'ascending' ? -1 : 1;
      await button.click();
      const expected = before.map(id => byId.get(id)).sort((a, b) => (Number(a[field]) - Number(b[field])) * direction).map(row => row.village_id);
      assert.deepEqual(await ids(), expected);
      assert.equal(await page.locator('[aria-sort]').count(), 1);
      await verifyRows('baseline_risk');
    }
    const manuallySorted = await ids();
    for (const policy of policies) { await select('Focused policy', policy); assert.deepEqual(await ids(), manuallySorted); await verifyRows(policy); }
    await select('Capacity anchor', 13); await select('Coverage dimension', 'education');
    assert.deepEqual(await ids(), manuallySorted);
    await page.locator('[data-sort="focus"]').focus();
    await page.keyboard.press('Enter');
    await select('Focused policy', 'simple');
    assert.deepEqual((await ids()).slice(0, 3), ['33', '71', '47']);
    const sortMs = await page.evaluate(async () => {
      const start = performance.now(); document.querySelector('[data-sort="focus"]').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return performance.now() - start;
    });
    timings.push({ control: 'Table sort', ms: +sortMs.toFixed(1) });
    await select('Focused policy', 'grf');
    assert.equal((await ids())[0], '121');
    assert.equal(await page.locator('[data-sort="focus"]').locator('..').getAttribute('aria-sort'), 'descending');
    await select('Focused policy', 'simple');
    await page.locator('[data-sort="focus"]').click();
    await page.locator('.rank-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const bottom = await page.locator('[data-village="80"]').boundingBox();
    const scrollBox = await page.locator('.rank-scroll').boundingBox();
    assert(bottom.y + bottom.height <= scrollBox.y + scrollBox.height + 2);
    const header = await page.locator('.rank-table thead').boundingBox();
    assert(Math.abs(header.y - scrollBox.y) < 2, 'Both header tiers remain fixed');
    await measure('Coverage dimension', 'age');
    await measure('Coverage dimension', 'sex');
    assert.equal(documents, initialDocuments, 'Selectors never reload the document');
    assert.equal(dataRequests.length, initialRequests, 'Loaded selector updates never fetch data');
    await select('Capacity anchor', 64);
    await select('Focused policy', 'grf');
    const remembered = page.url();
    await select('Coverage dimension', 'income');
    const incomeURL = page.url();
    await page.goBack(); assert.equal(page.url(), remembered); assert.equal(await page.getByLabel('Coverage dimension', { exact: true }).inputValue(), 'sex');
    await page.goForward(); assert.equal(page.url(), incomeURL);
    await page.reload(); await page.waitForSelector('[data-testid="rankings"]');
    assert.equal(await page.getByLabel('Coverage dimension', { exact: true }).inputValue(), 'income');
    await page.getByRole('link', { name: 'Page 4 spike', exact: true }).click();
    await page.waitForSelector('[data-chart="value"] svg');
    assert.equal(await page.getByLabel('Focused policy', { exact: true }).inputValue(), 'simple');
    assert.equal(await page.getByLabel('Capacity anchor', { exact: true }).inputValue(), '64');
    const chartIDs = await page.locator('[data-chart]').evaluateAll(nodes => nodes.map(node => node.getAttribute('_echarts_instance_')));
    const plotBoxes = await page.locator('[data-chart]').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, height: node.clientHeight })));
    for (const policy of policies) for (const k of capacities) {
      await measure('Focused policy', policy); await measure('Capacity anchor', k);
      const row = data.anchors.find(row => row.policy === policy && row.capacity_villages === k);
      assert.equal(await text('[data-testid="rollout-value"]'), `${row.point_population_rollout_value.toFixed(4)} pp`);
      assert.equal(await text('[data-testid="gain-value"]'), `${row.point_gain_vs_random.toFixed(4)} pp`);
      assert.equal(await text('[data-testid="covered-value"]'), `${row.n_selected_randomized.toLocaleString('en-US')} / 4,533`);
      assert.deepEqual(await page.locator('[data-chart]').evaluateAll(nodes => nodes.map(node => node.getAttribute('_echarts_instance_'))), chartIDs, 'Chart instances must persist');
      assert.deepEqual(await page.locator('[data-chart]').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, height: node.clientHeight }))), plotBoxes);
    }
    await page.getByLabel('Inspect chart capacity', { exact: true }).focus();
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    assert.match(await text('#inspection-status'), /K=1\./);
    const hoverURL = page.url();
    const chart = await page.locator('[data-chart="value"]').boundingBox();
    await page.mouse.move(chart.x + chart.width * 0.5, chart.y + chart.height * 0.5);
    await page.waitForFunction(() => document.querySelector('[data-chart="value"]').textContent.includes('covered'));
    assert.equal(page.url(), hoverURL, 'Hover must not write URL state');
    const gain = await page.locator('[data-chart="gain"]').innerHTML();
    assert(gain.includes('#7B8494'), 'Zero reference rendered');
    assert(gain.includes('0.14'), 'Selected CI band rendered');
    await page.getByRole('link', { name: 'Page 5 spike', exact: true }).click();
    assert.equal(page.url(), incomeURL, 'Each page remembers its own state');
    await page.getByRole('link', { name: 'Open default state' }).click();
    await page.waitForSelector('[data-testid="rankings"]');
    assert.deepEqual((await ids()).slice(0, 3), ['33', '71', '47']);
    assert.equal(page.url(), `${base}/__spikes/page5`);
    await page.goto(`${base}/__spikes/page5?policy=wrong&k=13&k=64&dimension=wrong&unapproved=x`);
    await page.waitForSelector('[data-testid="rankings"]');
    assert.equal(page.url(), `${base}/__spikes/page5`);
    assert.match(await page.getByRole('status').innerText(), /Invalid state reset/);
    for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const target of ['page4', 'page5']) {
        await page.goto(`${base}/__spikes/${target}`);
        await page.waitForSelector(target === 'page4' ? '[data-chart="gain"] svg' : '[data-testid="rankings"]');
        await page.waitForTimeout(100);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Body overflow ${target} ${width}`);
        if (target === 'page4') {
          assert.equal(await page.locator('[data-chart] svg').count(), 2);
          assert(await page.locator('[data-chart]').evaluateAll(nodes => nodes.every(node => node.clientWidth > 200)));
        } else if (width === 1920) assert(await page.locator('.rank-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        await page.screenshot({ path: path.join(qa, `spike-${target}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${base}/__spikes/page4`);
    await page.waitForSelector('[data-chart="gain"] svg');
    const motionIDs = await page.locator('[data-chart]').evaluateAll(nodes => nodes.map(node => node.getAttribute('_echarts_instance_')));
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      await page.waitForTimeout(50);
      assert.deepEqual(await page.locator('[data-chart]').evaluateAll(nodes => nodes.map(node => node.getAttribute('_echarts_instance_'))), motionIDs);
    }
    const failed = await browser.newPage();
    await failed.route('**/data/villages.json', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + ' ' });
    });
    await failed.goto(`${base}/__spikes/page5`);
    await failed.getByRole('alert').filter({ hasText: 'Validated public data is unavailable' }).waitFor();
    assert.equal(await failed.locator('[data-testid="rankings"]').count(), 0, 'Data failures must not render invented values');
    await failed.close();
    assert.deepEqual(errors, []);
    const summary = Object.fromEntries([...new Set(timings.map(row => row.control))].map(control => {
      const values = timings.filter(row => row.control === control).map(row => row.ms).sort((a, b) => a - b);
      return [control, { samples: values.length, median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1) }];
    }));
    const result = { status: 'PASS', browser: browser.version(), node: process.version, cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()}`, viewport: '1920x1080, DPR 1; no throttling; reduced motion', timings: summary, checks: '75 Page-5 states; 18 sorts; integrity; scope; frozen KPIs; persistence; history; refresh; reset; invalid URLs; 15 Page-4 states; chart lifecycle; tooltip/keyboard access; four widths' };
    fs.writeFileSync(path.join(qa, 'spike-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
