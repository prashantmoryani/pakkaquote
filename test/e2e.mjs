// End-to-end check against a running server: BASE=http://localhost:3000 npm test
// Walks the whole loop: Claude (MCP client) creates -> person edits -> client views, asks for a change, accepts.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.BASE || 'http://localhost:3000';
let cookie = '';
const web = async (path, { method = 'GET', form, json, auth = true } = {}) => {
  const headers = {};
  if (auth && cookie) headers.cookie = cookie;
  let body;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
  const set = res.headers.get('set-cookie');
  if (set && auth) cookie = set.split(';')[0];
  return res;
};
const step = (name) => console.log('ok  ' + name);

const email = `t${Date.now()}@example.com`;
let res = await web('/signup', { method: 'POST', form: { email, password: 'test-pass-123', business_name: 'E2E <Paints> & Co' } });
assert.equal(res.status, 302); step('sign up');

const dash = await (await web('/app')).text();
const mcpUrl = dash.match(/value="([^"]+\/mcp\/[^"]+)"/)[1];
step('dashboard shows Claude link');

const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ['create_quote', 'get_business_context', 'get_quote', 'list_quotes', 'save_rate_card_items', 'update_quote']);
step('MCP connect + 6 tools');

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return r.isError ? { error: text } : JSON.parse(text);
};
const ctx = await call('get_business_context');
assert.equal(ctx.rate_card.length, 8); assert.equal(ctx.default_tax_pct, 18);
step('get_business_context returns rate card');

const made = await call('create_quote', {
  client_name: 'Arjun <b>Rao</b>', title: '2BHK repaint', site_address: 'Indiranagar',
  items: [{ description: 'Interior repaint, premium emulsion, 2 coats', qty: 1200, unit: 'sq ft', rate: 18 },
    { description: 'Terrace waterproofing, 2 coats elastomeric', qty: 600, unit: 'sq ft', rate: 38 }],
  discount: 2220,
});
// 21600 + 22800 = 44400; -2220 = 42180; GST 18% = 7592.4; total 49772.4
assert.equal(made.subtotal, 44400); assert.equal(made.tax, 7592.4); assert.equal(made.total, 49772.4);
assert.equal(made.status, 'draft'); assert.equal(made.number, 'Q-0001'); assert.equal(made.client_link, undefined);
const id = made.edit_url.split('/').pop();
step('create_quote: app numbers it and does the arithmetic');

const editor = await (await web(`/app/quotes/${id}`)).text();
assert.ok(editor.includes('Arjun &lt;b&gt;Rao&lt;/b&gt;')); assert.ok(!editor.includes('Arjun <b>Rao'));
step('quote appears in the editor, HTML escaped');

res = await web(`/api/quotes/${id}`, { method: 'PUT', json: { client_name: 'Arjun Rao', discount: 0,
  items: [{ description: 'Interior repaint, premium emulsion, 2 coats', qty: 1200, unit: 'sq ft', rate: 20 }] } });
const edited = await res.json();
assert.equal(edited.totals.total, 28320);
step('person edits it in the app');

const token = editor.match(/href="\/q\/([^"]+)"/)[1];
let pub = await (await web(`/q/${token}`, { auth: false })).text();
assert.ok(pub.includes('being updated'));
step('draft is not visible to the client');

res = await web(`/api/quotes/${id}/send`, { method: 'POST' });
assert.equal((await res.json()).status, 'sent');
pub = await (await web(`/q/${token}`)).text(); // owner preview: not counted
assert.ok(pub.includes('Owner preview'));
pub = await (await web(`/q/${token}`, { auth: false })).text();
assert.ok(pub.includes('Accept quote for') && pub.includes('Arjun Rao'));
let got = await call('get_quote', { quote: 'Q-0001' });
assert.equal(got.status, 'viewed'); assert.equal(got.views_by_client, 1);
step('send -> live client link, client view tracked, owner view not counted');

res = await web(`/q/${token}/changes`, { method: 'POST', auth: false, form: { name: 'Arjun Rao', message: 'Please add the balcony ceiling' } });
assert.equal(res.status, 302);
got = await call('get_quote', { quote: '1' });
assert.equal(got.status, 'changes_requested');
assert.ok(got.history.some((h) => h.what === 'comment' && h.message === 'Please add the balcony ceiling'));
step('client asks for a change, Claude can read it');

const revised = await call('update_quote', { quote: 'Q-0001', change_note: 'Added balcony ceiling',
  items: [...got.items.map(({ amount, ...it }) => it), { description: 'Balcony ceiling', qty: 80, unit: 'sq ft', rate: 20 }] });
assert.equal(revised.status, 'draft'); assert.equal(revised.subtotal, 25600);
pub = await (await web(`/q/${token}`, { auth: false })).text();
assert.ok(pub.includes('being updated'));
step('Claude revises -> back to draft until a person re-sends');

await web(`/api/quotes/${id}/send`, { method: 'POST' });
res = await web(`/q/${token}/accept`, { method: 'POST', auth: false, form: { name: 'Arjun Rao' } });
assert.equal(res.status, 302);
pub = await (await web(`/q/${token}`, { auth: false })).text();
assert.ok(pub.includes('PAKKA') && !pub.includes('Accept quote for'));
const locked = await call('update_quote', { quote: 'Q-0001', discount: 5000 });
assert.ok(locked.error && locked.error.includes('locked'));
res = await web(`/api/quotes/${id}`, { method: 'PUT', json: { discount: 5000 } });
assert.equal(res.status, 409);
const list = await call('list_quotes', { status: 'accepted' });
assert.equal(list.count, 1); assert.equal(list.quotes[0].accepted_by, 'Arjun Rao');
step('client accepts -> stamped and locked for Claude and for the app');

const up = await call('save_rate_card_items', { items: [{ name: 'Texture feature wall', unit: 'sq ft', rate: 95 }, { name: 'Wallpaper install', unit: 'roll', rate: 900 }] });
assert.deepEqual([up.added, up.updated], [1, 1]);
step('save_rate_card_items upserts');

res = await web(`/api/quotes/${id}/duplicate`, { method: 'POST' });
const dup = await res.json(); assert.ok(dup.id);
res = await web(`/api/quotes/${dup.id}`, { method: 'DELETE' }); assert.equal(res.status, 200);
step('duplicate and delete');

await client.close();
res = await fetch(`${BASE}/mcp/not-a-real-key`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
assert.equal(res.status, 404);
res = await web(`/app/quotes/${id}`, { auth: false }); assert.equal(res.status, 302);
const other = await web(`/api/quotes/${id}`, { method: 'PUT', auth: false, json: {} }); assert.equal(other.status, 401);
step('bad MCP key rejected, app pages need login');
console.log('\nAll checks passed against ' + BASE);
