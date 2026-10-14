// check_inline_js.js — 给「单文件 HTML 看板」做内联 JS 语法体检
//
// 为什么需要它：周看板 product.html 曾因 Python 三引号转义把 JS 写成裸引号，
//   页面看着"只是少了个下拉"，实际是 **SyntaxError → 主脚本整体不执行**
//   （DATA / METRICS / calc 全 undefined，整个看板全废）。构建完先跑一遍这个，
//   能在打开浏览器之前就发现，比在 Playwright 里追 pageerror 快得多。
//
// 用法:
//   node check_inline_js.js <文件...>          # 逐个文件检查
//   node check_inline_js.js _deploy/*.html     # 一次查一批
// 退出码: 有任何语法错误 → 1
const fs = require('fs');

function checkOne(file) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.log('SKIP ' + file + ' (读不到: ' + e.message + ')'); return 0; }

  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0, bad = 0;
  while ((m = re.exec(html))) {
    i++;
    // new Function 只解析不执行 —— 顶层有 DOM 调用也没关系
    try { new Function(m[1]); }
    catch (e) {
      bad++;
      // 报出出错位置附近的行, 方便直接改构建脚本里的注入块
      const lines = m[1].split('\n');
      const at = (/(\d+):(\d+)/.exec(e.message) || [])[2];
      let ctx = '';
      if (at && lines[+at - 1] !== undefined) {
        ctx = '\n       第 ' + at + ' 行: ' + lines[+at - 1].trim().slice(0, 160);
      }
      console.log('FAIL ' + file + ' script#' + i + ': ' + e.message + ctx);
    }
  }
  if (!bad) console.log('OK   ' + file + ' (' + i + ' 个 script, 语法正确)');
  return bad;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.log('用法: node check_inline_js.js <html...>');
  process.exit(2);
}
let total = 0;
for (const f of files) total += checkOne(f);
if (total) {
  console.log('\n共 ' + total + ' 处语法错误 —— 若来自构建脚本注入块，检查 Python 三引号里的 \\\' 隐患（见 _scan_escapes.py）');
  process.exit(1);
}
console.log('\n全部通过。');
