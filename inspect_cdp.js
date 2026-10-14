const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  console.log('contexts:', browser.contexts().length);
  for (const ctx of browser.contexts()) {
    console.log('  pages:', ctx.pages().length);
    for (const p of ctx.pages()) {
      console.log('    url:', p.url().slice(0, 200));
      console.log('    title:', await p.title().catch(() => ''));
    }
  }
  await browser.close().catch(()=>{});
})();
