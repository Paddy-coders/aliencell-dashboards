// check_cloud_perms.js — Supabase 云端权限只读探针（零数据改动）
//
// 为什么需要它：判断「匿名能不能写」时最容易踩的坑是——
//   PostgREST 对 UPDATE/DELETE 返回 204 并不代表有权限！RLS 的 USING 会把不满足条件的行
//   **过滤成 0 行**，而 0 行受影响同样返回 204。2026-09-23 本项目就因此误判过一次
//   （先得出"任何人都能改数据"的结论，实际 RLS 是拦住的）。
//
// 正确判据：用一个**必然不会成功落库**的写操作去撞 RLS —— 看报错码是谁先出现：
//   42501 / 401  → RLS 拦住了写入（安全）        ← 期望
//   23505 / 23514 → RLS 没拦，只是被主键/约束挡了（不安全，需补策略）
//
// 安全性：探针用 id=1 插入（主键必然冲突，即使 RLS 没拦也绝不可能落库），
//         并在结束时复核数据未被改动。全程无破坏性操作。
//
// 用法：node check_cloud_perms.js

const SB = 'https://oovvqvgrjqwogjwswaxx.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

let pass = 0, fail = 0, warn = 0;
const line = (tag, name, extra) =>
  console.log(`  ${tag === 'PASS' ? '✅' : tag === 'FAIL' ? '❌' : '⚠️'} ${name}` + (extra ? `  ${JSON.stringify(extra)}` : ''));
function report(tag, name, extra) {
  if (tag === 'PASS') pass++; else if (tag === 'FAIL') fail++; else warn++;
  line(tag, name, extra);
}

async function req(method, path, body, extraHeaders) {
  const res = await fetch(SB + '/rest/v1/' + path, {
    method,
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  let text = '';
  try { text = await res.text(); } catch (e) {}
  let code = '';
  try { code = (JSON.parse(text) || {}).code || ''; } catch (e) {}
  return { status: res.status, code, text };
}

(async () => {
  console.log('=== Supabase 云端权限探针（只读，零数据改动）===\n');

  // ---------- 1. 前提：mapping 只有 id=1 一行 ----------
  const before = await req('GET', 'mapping?select=id,updated_at');
  let beforeRows = [];
  try { beforeRows = JSON.parse(before.text); } catch (e) {}
  const okShape = before.status === 200 && beforeRows.length === 1 && beforeRows[0].id === 1;
  report(okShape ? 'PASS' : 'FAIL', 'mapping 表恰好只有 id=1 一行（写探针安全的前提）',
    okShape ? undefined : { status: before.status, rows: beforeRows });
  const updatedAtBefore = okShape ? beforeRows[0].updated_at : null;

  // ---------- 2. 匿名读：mapping 公开（设计如此，需知悉）----------
  const readMap = await req('GET', 'mapping?select=data');
  report(readMap.status === 200 ? 'PASS' : 'WARN',
    '匿名可读 mapping 的业务数据（设计允许；若不想公开需改 RLS + 前端带 JWT）',
    { status: readMap.status });

  // ---------- 3. 匿名写：必须被 RLS 拦住 ----------
  // 用 id=1 插入：主键必然冲突 → 无论 RLS 是否生效都不可能落库
  const ins = await req('POST', 'mapping', { id: 1, data: { __probe: 'check_cloud_perms' } });
  const blocked = ins.code === '42501' || ins.status === 401 || ins.status === 403;
  report(blocked ? 'PASS' : 'FAIL',
    blocked ? '匿名 INSERT 被 RLS 拦住(42501) —— 外部无法写入/投毒数据'
            : '匿名 INSERT 未被 RLS 拦住！任何人可写入或覆盖数据，必须立即补 RLS 写策略',
    { status: ins.status, code: ins.code, msg: (ins.text || '').slice(0, 120) });

  // ---------- 4. profiles（用户表）不得匿名可读 ----------
  const prof = await req('GET', 'profiles?select=*&limit=5');
  let profRows = null;
  try { profRows = JSON.parse(prof.text); } catch (e) {}
  const profSafe = prof.status === 401 || prof.status === 403 || (Array.isArray(profRows) && profRows.length === 0);
  report(profSafe ? 'PASS' : 'FAIL', '用户表 profiles 匿名读不到内容（RLS 过滤/拒绝）',
    { status: prof.status, rows: Array.isArray(profRows) ? profRows.length : 'n/a' });

  // ---------- 5. 复核数据未被改动 ----------
  const after = await req('GET', 'mapping?select=id,updated_at');
  let afterRows = [];
  try { afterRows = JSON.parse(after.text); } catch (e) {}
  const intact = JSON.stringify(afterRows) === JSON.stringify(beforeRows);
  report(intact ? 'PASS' : 'FAIL', '探针未改动任何数据（id 与 updated_at 前后一致）',
    intact ? { updated_at: updatedAtBefore } : { before: beforeRows, after: afterRows });

  console.log(`\n结果: ${pass} pass, ${warn} warn, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
