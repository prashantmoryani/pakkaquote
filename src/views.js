// Server-rendered pages. Every dynamic value goes through esc().
import { STATUS_LABEL, CURRENCIES, totals } from './quotes.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');
const TZ = process.env.DISPLAY_TZ || 'Asia/Kolkata';

export function money(n, currency = 'INR') {
  return new Intl.NumberFormat(CURRENCIES[currency] || 'en-IN', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n || 0);
}
const fmtDate = (d) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(d)) : '');
const fmtDay = (s) => (s ? fmtDate(`${s}T12:00:00Z`) : '');
const fmtWhen = (d) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date(d)) : '');
const taxName = (cur) => (cur === 'INR' ? 'GST' : 'Tax');
const num = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);

export const chip = (status) => `<span class="chip chip-${esc(status)}"><i></i>${esc(STATUS_LABEL[status] || status)}</span>`;
const jsonScript = (id, data) => `<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const logo = `<span class="logo"><svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true"><rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 14.5l4.2 4.2L20.5 10" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>PakkaQuote</span>`;

function layout({ title, body, ws = null, active = '', scripts = '', cls = '' }) {
  const nav = ws
    ? `<nav class="nav">
        <a href="/app" class="${active === 'quotes' ? 'on' : ''}">Quotes</a>
        <a href="/app/settings" class="${active === 'settings' ? 'on' : ''}">Rate card and settings</a>
        <form method="post" action="/logout"><button class="linkish">Log out</button></form>
      </nav>`
    : `<nav class="nav"><a href="/login">Log in</a><a class="btn btn-small" href="/signup">Create workspace</a></nav>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css">
</head><body class="${cls}">
<header class="top"><a class="brand" href="${ws ? '/app' : '/'}">${logo}</a>${nav}</header>
<main>${body}</main>
${scripts}
</body></html>`;
}

// ---------- shared quote sheet (public page + landing sample) ----------
function sheet(ws, quote, { stampOnly = false } = {}) {
  const t = totals(quote);
  const cur = ws.currency;
  const stamp = quote.status === 'accepted'
    ? `<div class="stamp" role="img" aria-label="Accepted"><b>PAKKA</b><span>Accepted by ${esc(quote.accepted_name)}</span><span>${esc(fmtDate(quote.accepted_at))}</span></div>` : '';
  return `<article class="sheet">
    <header class="sheet-head">
      <div>
        <p class="biz">${esc(ws.business_name)}</p>
        <p class="muted small">${[ws.address, ws.phone, ws.tax_id ? `${cur === 'INR' ? 'GSTIN' : 'Tax ID'} ${ws.tax_id}` : ''].filter(Boolean).map(esc).join('<br>')}</p>
      </div>
      <dl class="meta">
        <div><dt>Quote</dt><dd>${esc(quote.number)}</dd></div>
        <div><dt>Date</dt><dd>${esc(fmtDate(quote.sent_at || quote.created_at))}</dd></div>
        ${quote.valid_until ? `<div><dt>Valid until</dt><dd>${esc(fmtDay(quote.valid_until))}</dd></div>` : ''}
      </dl>
    </header>
    <section class="sheet-for">
      <p class="muted small">Prepared for</p>
      <p class="client">${esc(quote.client_name || 'Client')}</p>
      ${quote.site_address ? `<p class="muted">${esc(quote.site_address)}</p>` : ''}
    </section>
    <h1 class="sheet-title">${esc(quote.title || 'Quote')}</h1>
    ${quote.intro ? `<p class="intro">${nl2br(quote.intro)}</p>` : ''}
    <div class="lines">
      <div class="line line-head"><span>Work</span><span>Qty</span><span>Rate</span><span>Amount</span></div>
      ${t.items.map((it) => `<div class="line">
        <span class="l-desc">${esc(it.description)}${it.detail ? `<small>${esc(it.detail)}</small>` : ''}</span>
        <span class="l-qty">${num(it.qty)} ${esc(it.unit)}</span>
        <span class="l-rate">${money(it.rate, cur)}</span>
        <span class="l-amt">${money(it.amount, cur)}</span>
      </div>`).join('')}
    </div>
    <div class="sums-wrap">${stamp}<dl class="sums">
      <div><dt>Subtotal</dt><dd>${money(t.subtotal, cur)}</dd></div>
      ${t.discount ? `<div><dt>Discount</dt><dd>&minus; ${money(t.discount, cur)}</dd></div>` : ''}
      ${t.tax_pct ? `<div><dt>${taxName(cur)} ${num(t.tax_pct)}%</dt><dd>${money(t.tax, cur)}</dd></div>` : ''}
      <div class="grand"><dt>Total</dt><dd>${money(t.total, cur)}</dd></div>
    </dl></div>
    ${!stampOnly && quote.terms ? `<section class="terms"><h2>Terms</h2><p>${nl2br(quote.terms)}</p></section>` : ''}
  </article>`;
}

// ---------- landing ----------
export function landingPage({ sample, demo }) {
  const body = `
  <section class="hero">
    <div class="hero-copy">
      <h1>Tell Claude about the job. Send a quote your client can say yes to.</h1>
      <p class="lede">Paste your site notes or a photo of the measurement sheet into Claude. It writes the quote from your own rate card. PakkaQuote saves it, lets you fix anything, and gives the client a live link to accept or ask for a change.</p>
      <p class="cta"><a class="btn" href="/signup">Create your workspace</a><a class="btn btn-ghost" href="/login">Log in</a></p>
      ${demo ? `<p class="muted small">Just looking? Log in with <b>${esc(demo.email)}</b> and password <b>${esc(demo.password)}</b>.</p>` : ''}
    </div>
    <div class="hero-sheet" aria-hidden="true">${sample}</div>
  </section>
  <section class="how">
    <h2>How a quote goes from site visit to signed</h2>
    <ol class="steps">
      <li><b>Connect your Claude</b><span>Copy one link from your dashboard into Claude's connector settings. It takes a minute and you do it once.</span></li>
      <li><b>Describe the job</b><span>"3BHK repaint for Meera, 1,850 sq ft, plus the grills." Type it, paste the WhatsApp message or attach a photo of your notes.</span></li>
      <li><b>Check it and send</b><span>The draft lands here with your rates, GST and terms worked out. Change any line, then send the link on WhatsApp.</span></li>
      <li><b>The client says yes</b><span>They open the link on their phone, accept with their name or ask for a change. You see when they looked and what they said.</span></li>
    </ol>
  </section>
  <section class="split">
    <div><h3>Claude does</h3><p>Reads your notes and photos, picks the right items from your rate card and writes the quote. Your own Claude plan covers it.</p></div>
    <div><h3>PakkaQuote does</h3><p>Numbers the quote, does the arithmetic, keeps your rates, hosts the client link, records views and acceptance. There is no AI in this app.</p></div>
  </section>`;
  return layout({ title: 'PakkaQuote: quotes your clients can say yes to', body, cls: 'landing' });
}
export { sheet };

// ---------- auth ----------
export function authPage({ mode, error = '', values = {}, demo = null }) {
  const signup = mode === 'signup';
  const body = `<section class="auth">
    <h1>${signup ? 'Create your workspace' : 'Log in'}</h1>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <form method="post" action="/${signup ? 'signup' : 'login'}" class="stack">
      ${signup ? `<label>Business name<input name="business_name" required maxlength="120" value="${esc(values.business_name)}" placeholder="Brushwork Painting Co."></label>` : ''}
      <label>Email<input name="email" type="email" required autocomplete="email" value="${esc(values.email)}"></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<small>At least 8 characters.</small>' : ''}</label>
      <button class="btn">${signup ? 'Create workspace' : 'Log in'}</button>
    </form>
    <p class="muted">${signup ? 'Already have a workspace? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Create a workspace</a>'}</p>
    ${!signup && demo ? `<p class="muted small">Demo workspace: <b>${esc(demo.email)}</b> / <b>${esc(demo.password)}</b></p>` : ''}
  </section>`;
  return layout({ title: signup ? 'Create workspace' : 'Log in', body });
}

// ---------- connect panel ----------
function connectPanel(ws, baseUrl, open) {
  const url = `${baseUrl}/mcp/${ws.mcp_key}`;
  return `<details class="connect" ${open ? 'open' : ''}>
    <summary>Connect Claude to this workspace</summary>
    <div class="connect-body">
      <label>Your Claude link
        <span class="copyrow"><input readonly value="${esc(url)}" id="mcp-url" onclick="this.select()"><button type="button" class="btn btn-small" data-copy="#mcp-url">Copy link</button></span>
      </label>
      <ol>
        <li>In Claude, open <b>Settings</b>, then <b>Connectors</b>, and choose <b>Add custom connector</b>.</li>
        <li>Name it <b>PakkaQuote</b>, paste the link above and add it. There is no sign-in step.</li>
        <li>In a new chat, switch PakkaQuote on from the <b>+</b> menu under Connectors, then try the request below.</li>
      </ol>
      <p class="prompt">Make a quote for Arjun Rao, 2BHK interior repaint at Indiranagar, about 1,200 sq ft of walls, plus terrace waterproofing 600 sq ft. 5% off as he is a repeat client.</p>
      <p class="muted small">Treat this link like a password: anyone who has it can add quotes to this workspace. You can replace it in settings.</p>
    </div>
  </details>`;
}

// ---------- dashboard ----------
export function dashboardPage({ ws, quotes, baseUrl }) {
  const withTotals = quotes.map((qt) => ({ qt, t: totals(qt) }));
  const sum = (statuses) => withTotals.filter(({ qt }) => statuses.includes(qt.status)).reduce((s, { t }) => s + t.total, 0);
  const count = (statuses) => quotes.filter((qt) => statuses.includes(qt.status)).length;
  const rows = withTotals.map(({ qt, t }) => `<a class="qrow" href="/app/quotes/${qt.id}">
      <span class="q-num">${esc(qt.number)}${qt.source === 'claude' ? '<em title="Written by Claude">via Claude</em>' : ''}</span>
      <span class="q-who"><b>${esc(qt.client_name || 'No client yet')}</b><small>${esc(qt.title)}</small></span>
      <span class="q-total">${money(t.total, ws.currency)}</span>
      <span class="q-status">${chip(qt.status)}${qt.view_count ? `<small>Opened ${qt.view_count}&times;, last ${esc(fmtWhen(qt.last_viewed_at))}</small>` : ''}</span>
    </a>`).join('');
  const body = `
  <div class="page-head">
    <h1>Quotes</h1>
    <form method="post" action="/app/quotes"><button class="btn btn-ghost">New blank quote</button></form>
  </div>
  <dl class="figures">
    <div><dt>Waiting on clients</dt><dd>${money(sum(['sent', 'viewed', 'changes_requested']), ws.currency)}</dd><span>${count(['sent', 'viewed', 'changes_requested'])} open</span></div>
    <div><dt>Accepted</dt><dd>${money(sum(['accepted']), ws.currency)}</dd><span>${count(['accepted'])} won</span></div>
    <div><dt>Drafts to review</dt><dd>${count(['draft'])}</dd><span>${count(['changes_requested'])} with change requests</span></div>
  </dl>
  ${connectPanel(ws, baseUrl, quotes.length === 0)}
  ${quotes.length ? `<div class="qlist">${rows}</div>` : `<div class="empty"><h2>No quotes yet</h2><p>Connect Claude using the steps above and ask it for a quote. It appears here as a draft for you to check.</p></div>`}`;
  return layout({ title: 'Quotes', body, ws, active: 'quotes', scripts: '<script src="/static/common.js"></script>' });
}

// ---------- editor ----------
const EVENT_TEXT = {
  created: (e) => `${e.actor === 'Claude' ? 'Written by Claude' : 'Created by you'}`,
  revised: () => 'Revised by Claude, back to draft for your review',
  edited: () => 'Edited by you',
  sent: (e) => e.detail || 'Sent to client',
  viewed: (e) => `Opened by ${e.actor}`,
  comment: (e) => `${e.actor} asked for a change`,
  accepted: (e) => `Accepted by ${e.actor}`,
};
function timeline(events) {
  return `<ol class="timeline">${events.slice().reverse().map((e) => `<li class="ev ev-${esc(e.kind)}">
    <b>${esc((EVENT_TEXT[e.kind] || (() => e.kind))(e))}</b>
    ${e.detail && e.kind !== 'sent' ? `<q>${nl2br(e.detail)}</q>` : ''}
    <time>${esc(fmtWhen(e.created_at))}</time></li>`).join('')}</ol>`;
}

export function editorPage({ ws, quote, events, rates, baseUrl }) {
  const locked = quote.status === 'accepted';
  const link = `${baseUrl}/q/${quote.public_token}`;
  const live = quote.status !== 'draft';
  const lastComment = quote.status === 'changes_requested' ? events.filter((e) => e.kind === 'comment').pop() : null;
  const dis = locked ? 'disabled' : '';
  const wa = `https://wa.me/?text=${encodeURIComponent(`Hello ${quote.client_name || ''}, here is our quote ${quote.number} for ${quote.title}: ${link}`)}`;
  const body = `
  <p class="crumb"><a href="/app">Quotes</a> / ${esc(quote.number)}</p>
  ${lastComment ? `<div class="banner banner-red"><b>${esc(lastComment.actor)} asked for a change:</b> <q>${nl2br(lastComment.detail)}</q><span>Edit below, or ask Claude: "Revise ${esc(quote.number)} the way the client asked."</span></div>` : ''}
  ${locked ? `<div class="banner banner-green"><b>Accepted by ${esc(quote.accepted_name)} on ${esc(fmtDate(quote.accepted_at))}.</b> This quote is locked. Duplicate it if you need a new version.</div>` : ''}
  ${quote.status === 'draft' && quote.sent_at ? `<div class="banner banner-amber"><b>This revision is not live yet.</b> The client's link shows a "being updated" note until you send it again.</div>` : ''}
  <div class="editor">
    <section class="sheet edit-sheet">
      <header class="edit-head">
        <div><span class="q-num big">${esc(quote.number)}</span> ${chip(quote.status)}</div>
        <span class="save-state" id="save-state" aria-live="polite"></span>
      </header>
      <div class="grid2">
        <label>Client name<input data-field="client_name" value="${esc(quote.client_name)}" ${dis}></label>
        <label>Client phone<input data-field="client_phone" value="${esc(quote.client_phone)}" ${dis}></label>
        <label>Client email<input data-field="client_email" type="email" value="${esc(quote.client_email)}" ${dis}></label>
        <label>Site address<input data-field="site_address" value="${esc(quote.site_address)}" ${dis}></label>
      </div>
      <label>Job title<input class="title-input" data-field="title" value="${esc(quote.title)}" ${dis}></label>
      <label>Note to the client<textarea data-field="intro" rows="3" ${dis}>${esc(quote.intro)}</textarea></label>

      <h2>Work and prices</h2>
      <div class="e-lines" id="items"></div>
      ${locked ? '' : `<div class="add-row">
        <button type="button" class="btn btn-ghost btn-small" id="add-line">Add a line</button>
        <select id="add-rate" aria-label="Add a line from your rate card"><option value="">Add from rate card…</option>${rates.map((r, i) => `<option value="${i}">${esc(r.name)} (${money(r.rate, ws.currency)} / ${esc(r.unit)})</option>`).join('')}</select>
      </div>`}
      <dl class="sums e-sums">
        <div><dt>Subtotal</dt><dd id="s-subtotal"></dd></div>
        <div><dt><label for="f-discount">Discount</label></dt><dd><input id="f-discount" data-field="discount" data-num type="number" min="0" step="any" value="${esc(quote.discount)}" ${dis}></dd></div>
        <div><dt><label for="f-tax">${taxName(ws.currency)} %</label></dt><dd><input id="f-tax" data-field="tax_pct" data-num type="number" min="0" max="100" step="any" value="${esc(quote.tax_pct)}" ${dis}><span id="s-tax"></span></dd></div>
        <div class="grand"><dt>Total</dt><dd id="s-total"></dd></div>
      </dl>
      <div class="grid2">
        <label>Valid until<input data-field="valid_until" type="date" value="${esc(quote.valid_until)}" ${dis}></label>
      </div>
      <label>Terms<textarea data-field="terms" rows="5" ${dis}>${esc(quote.terms)}</textarea></label>
    </section>

    <aside class="side">
      <div class="panel">
        ${locked ? '' : `<button class="btn btn-wide" id="send">${quote.sent_at ? (quote.status === 'draft' ? 'Send revised quote' : 'Send again') : 'Send to client'}</button>
        <p class="muted small">${live ? 'The client link is live. Edits you make here show on it straight away.' : 'Sending makes the client link live. Nothing reaches the client until you share the link.'}</p>`}
        ${live ? `<label>Client link<span class="copyrow"><input readonly id="client-link" value="${esc(link)}" onclick="this.select()"><button type="button" class="btn btn-small" data-copy="#client-link">Copy</button></span></label>
        <a class="btn btn-ghost btn-wide" href="${esc(wa)}" target="_blank" rel="noopener">Share on WhatsApp</a>` : ''}
        <a class="btn btn-ghost btn-wide" href="/q/${esc(quote.public_token)}" target="_blank" rel="noopener">${live ? 'Open client view' : 'Preview client view'}</a>
        <div class="row-actions">
          <button type="button" class="linkish" id="duplicate">Duplicate</button>
          <button type="button" class="linkish danger" id="delete">Delete quote</button>
        </div>
      </div>
      <div class="panel">
        <h2>History</h2>
        ${quote.view_count ? `<p class="muted small">Opened ${quote.view_count} time${quote.view_count === 1 ? '' : 's'} by the client.</p>` : ''}
        ${timeline(events)}
      </div>
    </aside>
  </div>`;
  const data = { id: quote.id, items: quote.items, currency: ws.currency, locale: CURRENCIES[ws.currency] || 'en-IN', locked, rates };
  return layout({ title: `${quote.number} ${quote.client_name}`, body, ws, active: 'quotes',
    scripts: `${jsonScript('quote-data', data)}<script src="/static/common.js"></script><script src="/static/editor.js"></script>` });
}

// ---------- settings ----------
export function settingsPage({ ws, rates, baseUrl, saved }) {
  const body = `
  <div class="page-head"><h1>Rate card and settings</h1><span class="save-state" id="save-state" aria-live="polite">${saved ? 'Saved' : ''}</span></div>
  <section class="panel" id="rates">
    <h2>Rate card</h2>
    <p class="muted">Claude reads these prices before it writes a quote. Keep them current and every quote comes out at your rates. You can also tell Claude "update my rate card from this price list".</p>
    <div class="r-lines" id="rate-rows"></div>
    <div class="add-row"><button type="button" class="btn btn-ghost btn-small" id="add-rate-row">Add an item</button>
    <button type="button" class="btn btn-small" id="save-rates">Save rate card</button></div>
  </section>
  <section class="panel">
    <h2>Your business</h2>
    <form method="post" action="/app/settings" class="stack">
      <div class="grid2">
        <label>Business name<input name="business_name" required value="${esc(ws.business_name)}"></label>
        <label>Your name<input name="owner_name" value="${esc(ws.owner_name)}"></label>
        <label>Phone<input name="phone" value="${esc(ws.phone)}"></label>
        <label>GSTIN or tax ID<input name="tax_id" value="${esc(ws.tax_id)}"></label>
      </div>
      <label>Address<input name="address" value="${esc(ws.address)}"></label>
      <div class="grid4">
        <label>Currency<select name="currency">${Object.keys(CURRENCIES).map((c) => `<option ${c === ws.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Default ${taxName(ws.currency)} %<input name="default_tax_pct" type="number" min="0" max="100" step="any" value="${esc(ws.default_tax_pct)}"></label>
        <label>Quote valid for (days)<input name="default_valid_days" type="number" min="1" max="365" value="${esc(ws.default_valid_days)}"></label>
        <label>Quote number prefix<input name="quote_prefix" maxlength="8" value="${esc(ws.quote_prefix)}"></label>
      </div>
      <label>Default terms<textarea name="default_terms" rows="5">${esc(ws.default_terms)}</textarea></label>
      <button class="btn">Save business details</button>
    </form>
  </section>
  ${connectPanel(ws, baseUrl, true)}
  <form method="post" action="/app/settings/rotate-key" onsubmit="return confirm('Replace the Claude link? The old link stops working and you will need to add the new one in Claude.')">
    <button class="linkish danger">Replace my Claude link</button>
  </form>`;
  return layout({ title: 'Rate card and settings', body, ws, active: 'settings',
    scripts: `${jsonScript('rates-data', rates)}<script src="/static/common.js"></script><script src="/static/settings.js"></script>` });
}

// ---------- public client page ----------
export function publicPage({ ws, quote, isOwner, flash }) {
  const open = ['sent', 'viewed', 'changes_requested'].includes(quote.status);
  let body;
  if (quote.status === 'draft' && !isOwner) {
    body = `<section class="auth"><h1>This quote is being updated</h1><p>${esc(ws.business_name)} is making changes to quote ${esc(quote.number)}. Please check back shortly, or call ${esc(ws.phone || 'them')} if it is urgent.</p></section>`;
  } else {
    const actions = open ? `<section class="respond no-print">
        ${flash === 'changes' ? `<p class="banner banner-amber"><b>Sent.</b> ${esc(ws.business_name)} has your note and will update this quote.</p>` : ''}
        <form method="post" action="/q/${esc(quote.public_token)}/accept" class="accept">
          <h2>Happy with this quote?</h2>
          <label>Type your full name to accept<input name="name" required maxlength="80" value="${esc(quote.client_name)}" autocomplete="name"></label>
          <button class="btn btn-wide">Accept quote for ${money(totals(quote).total, ws.currency)}</button>
          <small class="muted">Accepting confirms the scope, price and terms above.</small>
        </form>
        <details class="change"><summary>Ask for a change instead</summary>
          <form method="post" action="/q/${esc(quote.public_token)}/changes" class="stack">
            <label>What should change?<textarea name="message" rows="3" required maxlength="2000" placeholder="For example: please skip the grills and add the balcony ceiling."></textarea></label>
            <input type="hidden" name="name" value="${esc(quote.client_name)}">
            <button class="btn btn-ghost">Send request</button>
          </form>
        </details>
      </section>` : '';
    body = `${isOwner ? `<p class="banner banner-amber no-print"><b>Owner preview.</b> This is what your client sees${quote.status === 'draft' ? ' once you send it' : ''}. Your own views are not counted. <a href="/app/quotes/${quote.id}">Back to editing</a></p>` : ''}
      ${quote.status === 'accepted' && flash === 'accepted' ? `<p class="banner banner-green no-print"><b>Thank you.</b> ${esc(ws.business_name)} has been told you accepted.</p>` : ''}
      ${sheet(ws, quote)}
      ${actions}
      <p class="foot no-print"><button class="linkish" onclick="window.print()">Print or save as PDF</button></p>`;
  }
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(`Quote ${quote.number} from ${ws.business_name}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css">
</head><body class="public"><main>${body}</main></body></html>`;
}

export function notFoundPage(ws) {
  return layout({ title: 'Not found', ws, body: `<section class="auth"><h1>Nothing here</h1><p>That page does not exist, or the link is no longer valid. <a href="${ws ? '/app' : '/'}">Go back</a></p></section>` });
}
