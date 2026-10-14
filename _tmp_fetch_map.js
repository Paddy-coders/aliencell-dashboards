const https = require('https');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=*&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
https.get(SB_URL, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }, s => {
  const b = []; s.on('data', c => b.push(c));
  s.on('end', () => {
    const j = JSON.parse(Buffer.concat(b).toString('utf8'));
    const row = j[0] || {};
    console.log('顶层键:', Object.keys(row).join(' | '));
    const d = row.data || {};
    console.log('data 键:', Object.keys(d).join(' | '));
    console.log('--- catalog(产品关系) 条数:', (d.catalog||[]).length);
    (d.catalog||[]).slice(0,12).forEach(c => console.log('   ', JSON.stringify(c)));
    console.log('--- asinMap 条数:', (d.asinMap||[]).length);
    (d.asinMap||[]).filter(a=>/X1|40W/i.test(JSON.stringify(a))).slice(0,12).forEach(a => console.log('   ', JSON.stringify(a)));
    console.log('--- woot 条数:', (d.woot||[]).length);
    (d.woot||[]).forEach(w => console.log('   ', JSON.stringify(w)));
    console.log('--- wootCfg:', JSON.stringify(d.wootCfg));
  });
}).on('error', e => console.error('ERR', e.message));
