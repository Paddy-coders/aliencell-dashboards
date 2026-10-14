// 进入易仓广告模块, 查看广告列表状态列
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  // 点击"广告"标签页
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-ant-tabs-tab, .entry-layout-header-menus__item')];
    const el = els.find(e => (e.textContent || '').trim() === '广告');
    if (el) { el.click(); return true; }
    return false;
  });
  console.log('点击广告标签:', clicked);
  await page.waitForTimeout(8000);

  // 收集所有可见 tab / 菜单项
  const tabs = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.home-ant-tabs-tab, .entry-layout-header-menus__item, [class*=menu] a, [class*=menu] span')) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 16) out.push(t);
    }
    return [...new Set(out)];
  });
  console.log('当前菜单项:', JSON.stringify(tabs));

  // 截图当前状态
  await page.screenshot({ path: 'ad_menu_state.png' });
  console.log('截图 ad_menu_state.png');

  // 提取页面中"状态"列相关文本
  const statusTexts = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const lines = body.split('\n').map(l => l.trim()).filter(l => l && /投放|暂停|关闭|结束|启用|禁用|停止/i.test(l));
    return lines.slice(0, 40);
  });
  console.log('状态相关文本:', JSON.stringify(statusTexts, null, 1).slice(0, 2000));

  // 尝试找广告管理子菜单
  const subMenu = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('a, [class*=tab], [class*=menu], [class*=nav]')) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 10 && /广告|活动|报告|投放/.test(t)) out.push({ t, cls: String(el.className).slice(0, 40) });
    }
    return out.slice(0, 30);
  });
  console.log('子菜单候选:', JSON.stringify(subMenu, null, 1).slice(0, 2000));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
