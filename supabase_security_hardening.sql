-- ============================================================
-- Supabase 安全加固（分档执行，每档可单独回滚）
-- 项目：oovvqvgrjqwogjwswaxx
-- 生成：2026-10-22
--
-- 【背景 / 实测结论】
--   * anon key 硬编码在静态站 HTML 源码里 —— 这是 Supabase 的**预期用法**，
--     Supabase 官方文档明确说 anon key 可以公开，安全性由 RLS 承担。
--     所以「key 泄露」不是问题，「RLS 没开」才是问题。
--   * 实测（2026-10-22）匿名（仅 anon key、无登录态）：
--       GET  /rest/v1/mapping?select=data  -> 200，15,740 字节（含 costTable 全部产品成本！）
--       GET  /rest/v1/profiles             -> 200 []（RLS 已开，安全）
--       PATCH /rest/v1/mapping (错 key)    -> 401 被 RLS 拦
--       PATCH /rest/v1/mapping (wb-map-2026) -> 204 成功  ← 任何拿到源码的人都能改数据
--
-- 【为什么不能靠 IP 限制】
--   Supabase 官方「Network Restrictions」需要 Pro/Team/Enterprise 计划，
--   而且**只作用于 Postgres 直连与连接池**，官方文档明确说明
--   **不适用于 PostgREST / Auth / Storage 这类 HTTPS API**。
--   本项目所有数据访问全走 REST ⇒ 开了 IP 白名单也挡不住。别指望它。
-- ============================================================


-- ------------------------------------------------------------
-- 第 0 步：先看现状（只读，随便跑）
-- ------------------------------------------------------------
select schemaname, tablename, rowsecurity as "RLS已启用"
from pg_tables where schemaname = 'public' order by tablename;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;


-- =============================================================
-- 档 1：堵住「匿名写入」【最高优先级】
--   现状：静态密钥 wb-map-2026 就在 mapping.html 源码里，
--         谁都能 PATCH 改 asinMap / catalog / costTable。
--         历史上真的被误写过一次（2026-10-21 测试事故 51→5）。
--   改后：必须登录（Supabase Auth）才能写。
--   ⚠️ 前置：前端 PATCH 必须把 Authorization 换成用户 token，
--            否则所有保存都会 401。见「配套代码改动」。
-- =============================================================
do $$
declare r record;
begin
  -- 不依赖旧策略名，直接清掉 mapping 上所有策略再重建
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'mapping'
  loop
    execute format('drop policy %I on public.mapping', r.policyname);
  end loop;
end $$;

alter table public.mapping enable row level security;

-- 读：保持现状（匿名可读）—— 档 1 先不动读，避免看板集体读不到数据
create policy "map_read_anon" on public.mapping
  for select using (true);

-- 写：必须登录
create policy "map_write_authed" on public.mapping
  for update to authenticated
  using (true) with check (true);

create policy "map_insert_authed" on public.mapping
  for insert to authenticated
  with check (true);


-- =============================================================
-- 档 2：堵住「匿名读取」—— 只有登录用户能读到 mapping
--   影响：所有看板页面的 fetch 都要带用户 token，否则读不到。
--   这是把整份数据（含成本）从「公开」变成「需登录」的关键一步。
--   ⚠️ 必须先完成配套代码改动再执行，否则线上看板会全部空白。
-- =============================================================
drop policy if exists "map_read_anon" on public.mapping;

create policy "map_read_authed" on public.mapping
  for select to authenticated
  using (true);


-- =============================================================
-- 档 3：成本单独隔离（最敏感，推荐最终态）
--   成本是最不能外泄的数据（25 个产品的成本价）。
--   把 costTable 从 mapping.data 里拆出来独立成表，
--   只有 role='admin' 能读；Python 构建脚本用 service_role key 读（不进前端）。
-- =============================================================
create table if not exists public.cost_table (
  id        int primary key default 1,
  products  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cost_table enable row level security;

-- 读：只有管理员（profiles.role = 'admin'）
create policy "cost_read_admin" on public.cost_table
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- 写：同样只有管理员
create policy "cost_write_admin" on public.cost_table
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

create policy "cost_insert_admin" on public.cost_table
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- 迁移现有成本数据到新表
insert into public.cost_table (id, products)
select 1, coalesce((data -> 'costTable' -> 'products'), '{}'::jsonb)
from public.mapping where id = 1
on conflict (id) do update
  set products = excluded.products, updated_at = now();


-- =============================================================
-- 回滚（出问题时用）
-- =============================================================
-- 回滚档 1/2（恢复匿名读 + 静态 key 写）：
--   drop policy if exists "map_read_authed" on public.mapping;
--   drop policy if exists "map_write_authed" on public.mapping;
--   drop policy if exists "map_insert_authed" on public.mapping;
--   create policy "map_read_anon" on public.mapping for select using (true);
--   create policy "map_write_key" on public.mapping for update
--     using (current_setting('request.headers', true)::json ->> 'x-admin-key' = 'wb-map-2026')
--     with check (current_setting('request.headers', true)::json ->> 'x-admin-key' = 'wb-map-2026');
--
-- 回滚档 3：
--   drop table if exists public.cost_table;


-- =============================================================
-- 配套代码改动（执行档 1/2 前必须完成）
--   现在所有页面读写都写死 anon key：
--     headers: { apikey: 'sb_publishable_...', Authorization: 'Bearer sb_publishable_...' }
--   要改成：
--     const tok = (JSON.parse(localStorage.getItem('wb_auth')||'null')||{}).access_token;
--     headers: {
--       apikey: 'sb_publishable_...',                       // 这个仍然给 anon
--       Authorization: 'Bearer ' + (tok || 'sb_publishable_...')  // 有登录态就用用户 token
--     }
--   涉及：daily / monthly / target / ad / product / woot / joybuy / mapping / index
-- =============================================================
