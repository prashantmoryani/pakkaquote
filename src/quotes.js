// Domain logic: workspaces, rate card, quotes. All arithmetic lives here, never in the model.
import { q, one } from './db.js';
import { hashPassword, randomToken } from './auth.js';

export const STATUSES = ['draft', 'sent', 'viewed', 'changes_requested', 'accepted'];
export const STATUS_LABEL = {
  draft: 'Draft', sent: 'Sent', viewed: 'Viewed', changes_requested: 'Changes requested', accepted: 'Accepted',
};
export const CURRENCIES = { INR: 'en-IN', USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE', AED: 'en-AE', AUD: 'en-AU', SGD: 'en-SG' };

const STARTER_TERMS =
  '50% advance to book the slot, 40% after putty and first coat, 10% on handover.\n' +
  'This quote covers the labour and materials listed above. Extra work is charged at our rate card and agreed in writing before it starts.\n' +
  'Site to be cleared of valuables before work begins. We mask furniture and floors and clean up at the end.';

// Sample rates so Claude has something to price with on day one. Owners overwrite these with their own.
const STARTER_RATES = [
  ['Interior repaint, premium emulsion, 2 coats', 'sq ft', 18, 'Walls and ceiling, light sanding included'],
  ['Interior fresh paint: putty 2 coats, primer, emulsion 2 coats', 'sq ft', 32, 'New or badly damaged walls'],
  ['Exterior weatherproof emulsion, 2 coats', 'sq ft', 22, 'Scaffolding extra above 2 floors'],
  ['Putty touch-up and crack filling', 'sq ft', 6, ''],
  ['Enamel on doors, windows and grills', 'sq ft', 45, ''],
  ['Terrace waterproofing, 2 coats elastomeric', 'sq ft', 38, ''],
  ['Texture feature wall', 'sq ft', 85, ''],
  ['Masking, floor protection and cleanup', 'lump sum', 3500, 'Per home'],
];

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).map((it) => ({
    description: str(it?.description, 300),
    detail: str(it?.detail, 600),
    qty: num(it?.qty, 0),
    unit: str(it?.unit, 24),
    rate: num(it?.rate, 0),
  })).filter((it) => it.description || it.qty || it.rate);
}

export function totals(quote) {
  const items = (quote.items || []).map((it) => ({ ...it, amount: round2(num(it.qty) * num(it.rate)) }));
  const subtotal = round2(items.reduce((s, it) => s + it.amount, 0));
  const discount = Math.min(round2(num(quote.discount)), subtotal);
  const taxable = round2(subtotal - discount);
  const tax = round2(taxable * num(quote.tax_pct) / 100);
  return { items, subtotal, discount, taxable, tax_pct: num(quote.tax_pct), tax, total: round2(taxable + tax) };
}

const addDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

// ---------- workspaces ----------
export async function createWorkspace({ email, password, business_name }) {
  const ws = await one(
    `INSERT INTO workspaces (email, password_hash, business_name, default_terms, mcp_key)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [email.toLowerCase().trim(), hashPassword(password), str(business_name, 120), STARTER_TERMS, randomToken(24)],
  );
  let pos = 0;
  for (const [name, unit, rate, notes] of STARTER_RATES) {
    await q(`INSERT INTO rate_items (workspace_id, name, unit, rate, notes, position) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ws.id, name, unit, rate, notes, pos++]);
  }
  return ws;
}
export const workspaceById = (id) => one(`SELECT * FROM workspaces WHERE id=$1`, [id]);
export const workspaceByEmail = (email) => one(`SELECT * FROM workspaces WHERE email=$1`, [String(email).toLowerCase().trim()]);
export const workspaceByKey = (key) => one(`SELECT * FROM workspaces WHERE mcp_key=$1`, [key]);

export async function updateWorkspace(id, b) {
  const currency = CURRENCIES[b.currency] ? b.currency : 'INR';
  return one(
    `UPDATE workspaces SET business_name=$2, owner_name=$3, phone=$4, address=$5, tax_id=$6, currency=$7,
       default_tax_pct=$8, default_terms=$9, default_valid_days=$10, quote_prefix=$11 WHERE id=$1 RETURNING *`,
    [id, str(b.business_name, 120) || 'My business', str(b.owner_name, 80), str(b.phone, 40), str(b.address, 300),
      str(b.tax_id, 40), currency, Math.min(num(b.default_tax_pct, 18), 100), str(b.default_terms, 4000),
      Math.max(1, Math.min(Math.round(num(b.default_valid_days, 15)), 365)), str(b.quote_prefix, 8) || 'Q-'],
  );
}
export const rotateKey = (id) => one(`UPDATE workspaces SET mcp_key=$2 WHERE id=$1 RETURNING *`, [id, randomToken(24)]);

// ---------- rate card ----------
export const rateCard = (wsId) => q(`SELECT id, name, unit, rate, notes FROM rate_items WHERE workspace_id=$1 ORDER BY position, id`, [wsId]);

export async function replaceRateCard(wsId, items) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 300)
    .map((it) => ({ name: str(it?.name, 200), unit: str(it?.unit, 24), rate: num(it?.rate), notes: str(it?.notes, 300) }))
    .filter((it) => it.name);
  await q(`DELETE FROM rate_items WHERE workspace_id=$1`, [wsId]);
  let pos = 0;
  for (const it of clean) {
    await q(`INSERT INTO rate_items (workspace_id, name, unit, rate, notes, position) VALUES ($1,$2,$3,$4,$5,$6)`,
      [wsId, it.name, it.unit, it.rate, it.notes, pos++]);
  }
  return rateCard(wsId);
}

export async function upsertRateItems(wsId, items) {
  const existing = await rateCard(wsId);
  let pos = existing.length, added = 0, updated = 0;
  for (const raw of (items || []).slice(0, 300)) {
    const it = { name: str(raw?.name, 200), unit: str(raw?.unit, 24), rate: num(raw?.rate), notes: str(raw?.notes, 300) };
    if (!it.name) continue;
    const match = existing.find((e) => e.name.toLowerCase() === it.name.toLowerCase());
    if (match) {
      await q(`UPDATE rate_items SET unit=$2, rate=$3, notes=$4 WHERE id=$1`, [match.id, it.unit || match.unit, it.rate, it.notes || match.notes]);
      updated++;
    } else {
      await q(`INSERT INTO rate_items (workspace_id, name, unit, rate, notes, position) VALUES ($1,$2,$3,$4,$5,$6)`,
        [wsId, it.name, it.unit, it.rate, it.notes, pos++]);
      added++;
    }
  }
  return { added, updated };
}

// ---------- quotes ----------
export async function logEvent(quoteId, kind, actor = '', detail = '') {
  await q(`INSERT INTO quote_events (quote_id, kind, actor, detail) VALUES ($1,$2,$3,$4)`, [quoteId, kind, str(actor, 80), str(detail, 2000)]);
}
export const eventsFor = (quoteId) => q(`SELECT kind, actor, detail, created_at FROM quote_events WHERE quote_id=$1 ORDER BY id`, [quoteId]);

async function nextNumber(ws) {
  const row = await one(`UPDATE workspaces SET next_number = next_number + 1 WHERE id=$1 RETURNING next_number - 1 AS n, quote_prefix`, [ws.id]);
  return `${row.quote_prefix}${String(row.n).padStart(4, '0')}`;
}

export async function createQuote(ws, data, source = 'manual') {
  const number = await nextNumber(ws);
  const validDays = data.valid_days != null ? Math.max(1, Math.min(Math.round(num(data.valid_days, 15)), 365)) : ws.default_valid_days;
  const quote = await one(
    `INSERT INTO quotes (workspace_id, number, public_token, source, client_name, client_phone, client_email, site_address,
       title, intro, items, discount, tax_pct, terms, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15) RETURNING *`,
    [ws.id, number, randomToken(12), source, str(data.client_name, 120), str(data.client_phone, 40), str(data.client_email, 120),
      str(data.site_address, 300), str(data.title, 200), str(data.intro, 2000), JSON.stringify(cleanItems(data.items)),
      num(data.discount), data.tax_pct != null ? Math.min(num(data.tax_pct), 100) : ws.default_tax_pct,
      data.terms != null ? str(data.terms, 4000) : ws.default_terms, cleanDate(data.valid_until) || addDays(validDays)],
  );
  await logEvent(quote.id, 'created', source === 'claude' ? 'Claude' : 'You', '');
  return quote;
}

export const quoteById = (wsId, id) => one(`SELECT * FROM quotes WHERE workspace_id=$1 AND id=$2`, [wsId, Number(id) || 0]);
export const quoteByToken = (token) => one(`SELECT * FROM quotes WHERE public_token=$1`, [String(token)]);
export async function quoteByRef(wsId, ref) {
  const r = String(ref ?? '').trim();
  return (await one(`SELECT * FROM quotes WHERE workspace_id=$1 AND lower(number)=lower($2)`, [wsId, r]))
    || (/^\d+$/.test(r) ? (await one(`SELECT * FROM quotes WHERE workspace_id=$1 AND number ~ $2 ORDER BY id DESC`, [wsId, `(^|[^0-9])0*${r}$`])) : null);
}
export const listQuotes = (wsId) => q(`SELECT * FROM quotes WHERE workspace_id=$1 ORDER BY id DESC LIMIT 500`, [wsId]);

const EDITABLE = ['client_name', 'client_phone', 'client_email', 'site_address', 'title', 'intro', 'items', 'discount', 'tax_pct', 'terms', 'valid_until'];

// Partial update: only keys present in `data` change.
export async function updateQuote(quote, data, actor = 'You') {
  if (quote.status === 'accepted') throw new Error('This quote is accepted and locked. Duplicate it to make a new version.');
  const next = { ...quote };
  for (const k of EDITABLE) if (data[k] !== undefined && data[k] !== null) next[k] = data[k];
  if (data.valid_days != null) next.valid_until = addDays(Math.max(1, Math.min(Math.round(num(data.valid_days, 15)), 365)));
  // When Claude revises a quote the client has already seen, it goes back to draft so a person reviews it before it is live again.
  const status = actor === 'Claude' && quote.status !== 'draft' ? 'draft' : quote.status;
  const updated = await one(
    `UPDATE quotes SET client_name=$2, client_phone=$3, client_email=$4, site_address=$5, title=$6, intro=$7, items=$8::jsonb,
       discount=$9, tax_pct=$10, terms=$11, valid_until=$12, status=$13, updated_at=now() WHERE id=$1 RETURNING *`,
    [quote.id, str(next.client_name, 120), str(next.client_phone, 40), str(next.client_email, 120), str(next.site_address, 300),
      str(next.title, 200), str(next.intro, 2000), JSON.stringify(cleanItems(next.items)), num(next.discount),
      Math.min(num(next.tax_pct), 100), str(next.terms, 4000), cleanDate(next.valid_until) || quote.valid_until, status],
  );
  if (actor === 'Claude') {
    await logEvent(quote.id, 'revised', 'Claude', str(data.change_note, 300));
  } else {
    const last = await one(`SELECT kind, actor, created_at FROM quote_events WHERE quote_id=$1 ORDER BY id DESC LIMIT 1`, [quote.id]);
    const recent = last && last.kind === 'edited' && Date.now() - new Date(last.created_at).getTime() < 15 * 60000;
    if (!recent) await logEvent(quote.id, 'edited', 'You', '');
  }
  return updated;
}

export async function sendQuote(quote) {
  if (quote.status === 'accepted') return quote;
  const updated = await one(`UPDATE quotes SET status='sent', sent_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [quote.id]);
  await logEvent(quote.id, 'sent', 'You', quote.sent_at ? 'Revised quote sent' : '');
  return updated;
}

export async function recordView(quote) {
  if (quote.status === 'draft') return quote;
  const status = quote.status === 'sent' ? 'viewed' : quote.status;
  const updated = await one(`UPDATE quotes SET view_count=view_count+1, last_viewed_at=now(), status=$2 WHERE id=$1 RETURNING *`, [quote.id, status]);
  if (quote.status === 'sent') await logEvent(quote.id, 'viewed', quote.client_name || 'Client', '');
  return updated;
}

export async function requestChanges(quote, name, message) {
  if (!['sent', 'viewed', 'changes_requested'].includes(quote.status)) return quote;
  const updated = await one(`UPDATE quotes SET status='changes_requested', updated_at=now() WHERE id=$1 RETURNING *`, [quote.id]);
  await logEvent(quote.id, 'comment', str(name, 80) || quote.client_name || 'Client', str(message, 2000));
  return updated;
}

export async function acceptQuote(quote, name) {
  if (!['sent', 'viewed', 'changes_requested'].includes(quote.status)) return quote;
  const signer = str(name, 80) || quote.client_name || 'Client';
  const updated = await one(`UPDATE quotes SET status='accepted', accepted_name=$2, accepted_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [quote.id, signer]);
  await logEvent(quote.id, 'accepted', signer, '');
  return updated;
}

export async function duplicateQuote(ws, quote) {
  return createQuote(ws, { ...quote, valid_until: '', valid_days: ws.default_valid_days }, 'manual');
}
export const deleteQuote = (quote) => q(`DELETE FROM quotes WHERE id=$1`, [quote.id]);

// ---------- demo seed ----------
export async function seedDemo() {
  const email = process.env.DEMO_EMAIL || 'demo@pakkaquote.app';
  if (await workspaceByEmail(email)) return;
  let ws = await createWorkspace({ email, password: process.env.DEMO_PASSWORD || 'pakka-demo', business_name: 'Brushwork Painting Co.' });
  ws = await updateWorkspace(ws.id, { ...ws, owner_name: 'Demo Owner', phone: '+91 98765 43210', address: 'HSR Layout, Bengaluru', tax_id: '29ABCDE1234F1Z5' });
  const quote = await createQuote(ws, {
    client_name: 'Meera Nair', client_phone: '+91 99000 11223', site_address: 'B-704, Lakeview Residency, Whitefield, Bengaluru',
    title: '3BHK interior repaint',
    intro: 'Thank you for having us over on Saturday. This covers a full interior repaint of the flat, done in 6 working days with a crew of 4.',
    items: [
      { description: 'Interior repaint, premium emulsion, 2 coats', detail: 'All walls and ceilings, 3 bedrooms, living, dining, kitchen', qty: 1850, unit: 'sq ft', rate: 18 },
      { description: 'Putty touch-up and crack filling', detail: 'Master bedroom and balcony wall', qty: 420, unit: 'sq ft', rate: 6 },
      { description: 'Enamel on doors, windows and grills', detail: '7 doors, 5 window grills', qty: 310, unit: 'sq ft', rate: 45 },
      { description: 'Masking, floor protection and cleanup', qty: 1, unit: 'lump sum', rate: 3500 },
    ],
    discount: 2000,
  }, 'claude');
  await sendQuote(quote);
}
