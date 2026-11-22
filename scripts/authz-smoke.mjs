import fs from 'fs';
const base = process.env.API_BASE || 'http://localhost:4000/api';
const admin = { email: process.env.ADMIN_EMAIL || 'admin@safari.ma', password: process.env.ADMIN_PASSWORD || 'Safari@Admin!2026#Sec' };
const out = [];
async function req(method, path, token, body) {
  const res = await fetch(base + path, { method, headers: { ...(body?{'Content-Type':'application/json'}:{}), ...(token?{Authorization:`Bearer ${token}`}:{}) }, body: body?JSON.stringify(body):undefined });
  let data=null; try{data=await res.json();}catch{}
  return {status:res.status,data};
}
function rec(name, ok, detail){ out.push({name,ok,detail}); console.log(`${ok?'PASS':'FAIL'} ${name} ${detail||''}`); }
const login = await req('POST','/auth/login',null,admin);
rec('admin login', login.status===200 && !!login.data?.token, login.status);
const t = login.data?.token;
const me = await req('GET','/auth/me',t); rec('auth me', me.status===200, me.status);
const g = await req('GET','/dashboard/global',t); rec('dashboard global', g.status===200, g.status);
const s = await req('GET','/dashboard/store/3',t); rec('dashboard store 3', s.status===200, s.status);
const unauth = await req('GET','/dashboard/global',null); rec('global unauth blocked', unauth.status===401||unauth.status===403, unauth.status);
const badId = await req('GET','/dashboard/store/abc',t); rec('bad id rejected', badId.status===400||badId.status===404, badId.status);
const ft = await req('GET','/documents/999999/file-token',t); rec('missing file token 404', ft.status===404||ft.status===403, ft.status);
fs.writeFileSync('docs/authz-smoke-report.json', JSON.stringify(out,null,2));
if(out.some(x=>!x.ok)) process.exit(1);
