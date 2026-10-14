
// ===== 云端更新提示：静默轮询(60s / 切回前台)，发现新数据只在顶部提示，点击才刷新 =====
// 用途：别人上传 Woot 报表或改动产品映射后，已经打开着的看板能主动告知，而不是等人自己发现。
// 只提示、不自动刷新：看板筛选(国家/ASIN/系列/产品名)是内存状态，自动 reload 会清空用户正在看的筛选。
//
// 三路比对(缺一不可)：
//   BASE_SIG  = 本页渲染时所依据的本机缓存快照
//   localSig  = 此刻本机缓存          → 与本浏览器别的标签页(如 Woot 上传页)写入后立刻不同
//   cloudSig  = 云端最新              → 别人在别的电脑上传/改映射后不同
// 只看云端会漏掉「同一浏览器上传」场景：那时本机已被写新，但当前页面渲染的还是旧数据。
(function cloudUpdateWatch(){
  const SB_ROW = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
  const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
  const POLL_MS = 60000;

  function lsGet(k, dflt){
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? dflt : v; } catch (e) { return dflt; }
  }
  // ★ 稳定序列化：对象的 key 先排序再拼 —— 两侧「同一份数据、不同键顺序」必须判为相等。
  //   踩过的坑(2026-10-14)：云端 wootCfg 存的是 {"cost":{},"price":1380}，而看板 load 同步
  //   会把它规范化成 {"price":1380,"cost":{}} 再写本机；JSON.stringify 保留插入顺序 ⇒
  //   两串永不相等 ⇒ 判定「云端有新数据」永远成立 ⇒ 提示条常驻、点「立即刷新」也不消失。
  function stable(v){
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function(k){ return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  // wootCfg 规范化：与看板 load 同步里的写法完全同款(price 兜底 1380 / cost 兜底 {})，确保两侧可比
  function normCfg(c){
    if (!c || typeof c !== 'object') return null;
    return { price: Number(c.price) > 0 ? Number(c.price) : 1380,
             cost: (c.cost && typeof c.cost === 'object') ? c.cost : {} };
  }
  function localSig(){
    const lc = normCfg(lsGet('pc_woot_cfg', null));
    return stable(lsGet('pc_woot', [])) + '\u0001' + stable(lsGet('pc_catalog', [])) + '\u0001'
      + stable(lsGet('pc_asinmap', [])) + '\u0001'
      // 本机没有成本设置(广告看板不消费 wootCfg) ⇒ 该段恒为空、不参与判定，避免误报常驻
      + (lc === null ? '' : stable(lc));
  }
  function cloudSig(j){
    if (!j || !Array.isArray(j.woot)) return null;   // 云端仍是旧结构(无 woot 键) → 不提示
    const lc = normCfg(lsGet('pc_woot_cfg', null));
    const cc = normCfg(j.wootCfg);
    return stable(j.woot) + '\u0001'
      + stable(Array.isArray(j.catalog) ? j.catalog : []) + '\u0001'
      + stable(Array.isArray(j.asinMap) ? j.asinMap : []) + '\u0001'
      // 云端缺 wootCfg 时沿用本机值 ⇒ 该段不参与判定(避免删配置后提示条永不消失)
      + (lc === null ? '' : stable(cc === null ? lc : cc));
  }

  const BASE_SIG = localSig();
  let bar = null, latest = null, offKey = null, cloudSigCache = null;
  const keyOf = (cs, ls) => cs + '#' + ls;

  function mk(tag, txt, css){
    const e = document.createElement(tag);
    if (txt !== null) e.textContent = txt;
    e.style.cssText = css;
    return e;
  }
  function ensureBar(){
    if (bar) return bar;
    bar = mk('div', null, 'position:fixed;z-index:2147483000;left:50%;top:12px;transform:translateX(-50%);display:none;align-items:center;gap:10px;max-width:92vw;padding:9px 12px;border-radius:10px;border:1px solid #854F0B;background:#FAEEDA;color:#412402;box-shadow:0 2px 8px rgba(0,0,0,.12);font-size:13px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.45');
    bar.id = 'wbUpdateBar';
    bar.setAttribute('role', 'status');
    const label = mk('span', '云端数据已更新', 'font-weight:500;white-space:nowrap');
    const btn = mk('button', '立即刷新', 'cursor:pointer;border:1px solid #854F0B;background:#fff;color:#412402;border-radius:6px;padding:3px 10px;font-size:12px;font-family:inherit;white-space:nowrap');
    btn.type = 'button';
    btn.title = '刷新页面载入最新数据（会重置当前筛选条件）';
    btn.onclick = apply;
    const x = mk('button', '×', 'cursor:pointer;border:0;background:transparent;color:#854F0B;font-size:16px;font-family:inherit;line-height:1;padding:0 2px');
    x.type = 'button';
    x.title = '本次不再提示';
    x.onclick = function(){ offKey = keyOf(cloudSigCache, localSig()); hide(); };
    bar.appendChild(label); bar.appendChild(btn); bar.appendChild(x);
    (document.body || document.documentElement).appendChild(bar);
    return bar;
  }
  function show(){ ensureBar().style.display = 'flex'; }
  function hide(){ if (bar) bar.style.display = 'none'; }

  function apply(){
    const ls = localSig();
    // 本机缓存已被别的标签页更新过(同浏览器上传场景) → 不用云端值回写，直接重载出新数据
    if (ls === BASE_SIG && latest) {
      try {
        if (Array.isArray(latest.woot)) localStorage.setItem('pc_woot', JSON.stringify(latest.woot));
        if (Array.isArray(latest.catalog)) localStorage.setItem('pc_catalog', JSON.stringify(latest.catalog));
        if (Array.isArray(latest.asinMap)) localStorage.setItem('pc_asinmap', JSON.stringify(latest.asinMap));
      } catch (e) {}
    }
    location.reload();
  }

  async function check(){
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(SB_ROW, { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const rows = await r.json();
      const j = rows && rows[0] && rows[0].data;
      const cs = cloudSig(j);
      if (cs === null) return;
      latest = j; cloudSigCache = cs;
      const ls = localSig();
      if (keyOf(cs, ls) === offKey) { hide(); return; }
      if (cs === ls && ls === BASE_SIG) { hide(); return; }
      show();
    } catch (e) {}
  }

  setTimeout(check, 5000);
  setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) check(); });
})();
