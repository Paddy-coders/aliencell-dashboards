const { chromium } = require('./playwright-auth');
const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///' + BASE + '/monthly.html', { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => {
    const out = { summary: document.getElementById('ddChannelSummary').textContent };
    out.opts = [...document.querySelectorAll('#ddChannelList .dd-opt')].map(e => e.textContent.trim());
    const mk = (set, ym) => { selChannel = set; const a = aggMonth(ym, filteredRows()); return { sales: monthVal(a,'sales'), adCost: monthVal(a,'adCost'), profit: monthVal(a,'profit'), orders: monthVal(a,'orders') }; };
    out['2026-09_merged'] = mk(new Set(), '2026-09');
    out['2026-09_woot'] = mk(new Set(['woot']), '2026-09');
    out['2026-09_amazon'] = mk(new Set(['amazon']), '2026-09');
    out.wootRows = DATA.rows.filter(x => x.channel === 'woot').length;
    selChannel = new Set();
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('page errors:', errs);
  await b.close();
})();
