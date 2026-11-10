// PakkaQuote: one small service. Web app + MCP endpoint + Postgres. No AI keys, no model calls.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, dbKind } from './src/db.js';
import { setSession, clearSession, readSession, verifyPassword } from './src/auth.js';
import * as Q from './src/quotes.js';
import * as V from './src/views.js';
import { mountMcp } from './src/mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const demo = process.env.HIDE_DEMO ? null
  : { email: process.env.DEMO_EMAIL || 'demo@pakkaquote.app', password: process.env.DEMO_PASSWORD || 'pakka-demo' };

app.get('/healthz', (req, res) => res.json({ ok: true, db: dbKind }));

// ---------- MCP (the customer's Claude talks to this) ----------
mountMcp(app, baseUrl);

// ---------- session ----------
app.use(async (req, res, next) => {
  const id = readSession(req);
  req.ws = id ? await Q.workspaceById(id) : null;
  next();
});
const needLogin = (req, res, next) => {
  if (req.ws) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Log in again to continue.' });
  res.redirect('/login');
};

// ---------- public pages ----------
const SAMPLE_WS = { business_name: 'Brushwork Painting Co.', address: 'HSR Layout, Bengaluru', phone: '+91 98765 43210', tax_id: '', currency: 'INR' };
const SAMPLE_QUOTE = {
  number: 'Q-0042', status: 'accepted', accepted_name: 'Meera Nair', accepted_at: new Date(), created_at: new Date(), valid_until: '',
  client_name: 'Meera Nair', site_address: 'B-704, Lakeview Residency, Whitefield', title: '3BHK interior repaint', intro: '',
  items: [
    { description: 'Interior repaint, premium emulsion, 2 coats', detail: 'All walls and ceilings', qty: 1850, unit: 'sq ft', rate: 18 },
    { description: 'Enamel on doors, windows and grills', detail: '7 doors, 5 grills', qty: 310, unit: 'sq ft', rate: 45 },
    { description: 'Masking, floor protection and cleanup', qty: 1, unit: 'lump sum', rate: 3500 },
  ],
  discount: 2000, tax_pct: 18, terms: '',
};
app.get('/', (req, res) => {
  if (req.ws) return res.redirect('/app');
  res.send(V.landingPage({ sample: V.sheet(SAMPLE_WS, SAMPLE_QUOTE, { stampOnly: true }), demo }));
});

app.get('/login', (req, res) => (req.ws ? res.redirect('/app') : res.send(V.authPage({ mode: 'login', demo }))));
app.get('/signup', (req, res) => (req.ws ? res.redirect('/app') : res.send(V.authPage({ mode: 'signup' }))));

app.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const ws = await Q.workspaceByEmail(email);
  if (!ws || !verifyPassword(password, ws.password_hash)) {
    return res.status(401).send(V.authPage({ mode: 'login', demo, values: { email }, error: 'That email and password do not match a workspace.' }));
  }
  setSession(res, ws.id, req.secure);
  res.redirect('/app');
});

app.post('/signup', async (req, res) => {
  const { email = '', password = '', business_name = '' } = req.body || {};
  const values = { email, business_name };
  const bad = (error) => res.status(400).send(V.authPage({ mode: 'signup', values, error }));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('Enter a valid email address.');
  if (password.length < 8) return bad('Use a password with at least 8 characters.');
  if (!business_name.trim()) return bad('Enter your business name. It appears at the top of every quote.');
  if (await Q.workspaceByEmail(email)) return bad('A workspace already uses that email. Log in instead.');
  const ws = await Q.createWorkspace({ email, password, business_name });
  setSession(res, ws.id, req.secure);
  res.redirect('/app');
});

app.post('/logout', (req, res) => { clearSession(res); res.redirect('/'); });

// ---------- client-facing quote ----------
app.get('/q/:token', async (req, res) => {
  let quote = await Q.quoteByToken(req.params.token);
  if (!quote) return res.status(404).send(V.notFoundPage(null));
  const ws = await Q.workspaceById(quote.workspace_id);
  const isOwner = req.ws?.id === ws.id;
  if (!isOwner) quote = await Q.recordView(quote);
  res.setHeader('Cache-Control', 'no-store');
  res.send(V.publicPage({ ws, quote, isOwner, flash: String(req.query.done || '') }));
});
app.post('/q/:token/accept', async (req, res) => {
  const quote = await Q.quoteByToken(req.params.token);
  if (!quote) return res.status(404).send(V.notFoundPage(null));
  await Q.acceptQuote(quote, req.body?.name);
  res.redirect(`/q/${quote.public_token}?done=accepted`);
});
app.post('/q/:token/changes', async (req, res) => {
  const quote = await Q.quoteByToken(req.params.token);
  if (!quote) return res.status(404).send(V.notFoundPage(null));
  if (String(req.body?.message || '').trim()) await Q.requestChanges(quote, req.body?.name, req.body.message);
  res.redirect(`/q/${quote.public_token}?done=changes`);
});

// ---------- app ----------
app.get('/app', needLogin, async (req, res) => {
  res.send(V.dashboardPage({ ws: req.ws, quotes: await Q.listQuotes(req.ws.id), baseUrl: baseUrl(req) }));
});
app.post('/app/quotes', needLogin, async (req, res) => {
  const quote = await Q.createQuote(req.ws, { title: 'New quote', items: [] });
  res.redirect(`/app/quotes/${quote.id}`);
});
app.get('/app/quotes/:id', needLogin, async (req, res) => {
  const quote = await Q.quoteById(req.ws.id, req.params.id);
  if (!quote) return res.status(404).send(V.notFoundPage(req.ws));
  res.setHeader('Cache-Control', 'no-store');
  res.send(V.editorPage({ ws: req.ws, quote, events: await Q.eventsFor(quote.id), rates: await Q.rateCard(req.ws.id), baseUrl: baseUrl(req) }));
});
app.get('/app/settings', needLogin, async (req, res) => {
  res.send(V.settingsPage({ ws: req.ws, rates: await Q.rateCard(req.ws.id), baseUrl: baseUrl(req), saved: req.query.saved === '1' }));
});
app.post('/app/settings', needLogin, async (req, res) => {
  await Q.updateWorkspace(req.ws.id, req.body || {});
  res.redirect('/app/settings?saved=1');
});
app.post('/app/settings/rotate-key', needLogin, async (req, res) => {
  await Q.rotateKey(req.ws.id);
  res.redirect('/app/settings?saved=1');
});

// ---------- JSON API used by the editor ----------
const loadQuote = async (req, res, next) => {
  req.quote = await Q.quoteById(req.ws.id, req.params.id);
  if (!req.quote) return res.status(404).json({ error: 'Quote not found.' });
  next();
};
app.put('/api/quotes/:id', needLogin, loadQuote, async (req, res) => {
  try {
    const quote = await Q.updateQuote(req.quote, req.body || {}, 'You');
    res.json({ ok: true, status: quote.status, totals: Q.totals(quote) });
  } catch (e) { res.status(409).json({ error: e.message }); }
});
app.post('/api/quotes/:id/send', needLogin, loadQuote, async (req, res) => {
  const quote = await Q.sendQuote(req.quote);
  res.json({ ok: true, status: quote.status, client_link: `${baseUrl(req)}/q/${quote.public_token}` });
});
app.post('/api/quotes/:id/duplicate', needLogin, loadQuote, async (req, res) => {
  const copy = await Q.duplicateQuote(req.ws, req.quote);
  res.json({ ok: true, id: copy.id });
});
app.delete('/api/quotes/:id', needLogin, loadQuote, async (req, res) => {
  await Q.deleteQuote(req.quote);
  res.json({ ok: true });
});
app.put('/api/rate-card', needLogin, async (req, res) => {
  res.json({ ok: true, rates: await Q.replaceRateCard(req.ws.id, req.body?.items) });
});

app.use((req, res) => res.status(404).send(V.notFoundPage(req.ws)));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
  res.status(500).send('Something went wrong on our side. Try again in a moment.');
});

const port = Number(process.env.PORT) || 3000;
await initDb();
await Q.seedDemo();
app.listen(port, () => console.log(`PakkaQuote listening on :${port} (db: ${dbKind})`));
