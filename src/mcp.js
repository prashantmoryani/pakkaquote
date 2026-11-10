// MCP server: the plug between the customer's own Claude and this app.
// Stateless Streamable HTTP. One URL per workspace: /mcp/<workspace key>.
// Nothing in here calls a model. Claude does the reading and writing; these tools only save and fetch.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as Q from './quotes.js';

const itemSchema = z.object({
  description: z.string().describe('What the work is, in the client\'s language. Prefer the exact rate card item name when one applies.'),
  detail: z.string().optional().describe('Optional scope note: rooms, areas, brand, number of coats.'),
  qty: z.number().describe('Quantity, e.g. area in sq ft. Use 1 for lump sum items.'),
  unit: z.string().describe('Unit, e.g. "sq ft", "rft", "nos", "lump sum".'),
  rate: z.number().describe('Price per unit in the workspace currency, before tax. Take it from the rate card unless the user gave a different rate.'),
});

const quoteFields = {
  client_name: z.string().describe('Client or company the quote is for.'),
  title: z.string().describe('Short job title, e.g. "3BHK interior repaint".'),
  items: z.array(itemSchema).min(1).describe('Line items. Do not include totals or tax lines; the app calculates those.'),
  client_phone: z.string().optional(),
  client_email: z.string().optional(),
  site_address: z.string().optional(),
  intro: z.string().optional().describe('One or two warm sentences to the client: what the quote covers and how long the job takes.'),
  discount: z.number().optional().describe('Flat discount amount before tax. Omit if none.'),
  tax_pct: z.number().optional().describe('Tax percent. Omit to use the business default.'),
  terms: z.string().optional().describe('Payment and scope terms. Omit to use the business default terms.'),
  valid_days: z.number().optional().describe('Days the quote stays valid. Omit to use the business default.'),
};

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

function summary(quote, baseUrl) {
  const t = Q.totals(quote);
  return {
    number: quote.number,
    status: quote.status,
    client_name: quote.client_name,
    title: quote.title,
    subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total,
    valid_until: quote.valid_until,
    views_by_client: quote.view_count,
    last_viewed_at: quote.last_viewed_at,
    sent_at: quote.sent_at,
    accepted_by: quote.accepted_name || undefined,
    edit_url: `${baseUrl}/app/quotes/${quote.id}`,
    client_link: quote.status === 'draft' ? undefined : `${baseUrl}/q/${quote.public_token}`,
  };
}

export function buildServer(ws, baseUrl) {
  const server = new McpServer(
    { name: 'pakkaquote', version: '1.0.0' },
    {
      instructions:
        `PakkaQuote stores quotes for ${ws.business_name}. To write a quote: call get_business_context first and price ` +
        'from the rate card, then call create_quote. Quotes are saved as drafts; the user reviews, edits and sends them ' +
        'from the edit_url, so always show that link. Never state totals yourself: read them from the tool result.',
    },
  );

  server.registerTool('get_business_context', {
    title: 'Get business profile and rate card',
    description: 'Returns the contractor\'s business profile, default tax and terms, and their rate card (their own prices per unit). Call this before creating or repricing a quote so prices are theirs, not guesses.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const fresh = await Q.workspaceById(ws.id);
    return ok({
      business_name: fresh.business_name, owner_name: fresh.owner_name, currency: fresh.currency,
      default_tax_pct: fresh.default_tax_pct, default_valid_days: fresh.default_valid_days, default_terms: fresh.default_terms,
      rate_card: (await Q.rateCard(ws.id)).map(({ name, unit, rate, notes }) => ({ name, unit, rate, notes: notes || undefined })),
      guidance: 'Use rate card rates. If the job needs something that is not on the rate card, ask the user for the rate or propose one and say clearly that it is your estimate.',
    });
  });

  server.registerTool('create_quote', {
    title: 'Create a quote',
    description: 'Saves a new draft quote in PakkaQuote from site notes, a measurement sheet photo, a WhatsApp message or a voice transcript. The app numbers it, calculates totals and tax, and returns a link where the user can edit it and send it to the client.',
    inputSchema: quoteFields,
  }, async (args) => {
    const quote = await Q.createQuote(await Q.workspaceById(ws.id), args, 'claude');
    return ok({ saved: true, ...summary(quote, baseUrl), next_step: 'Give the user the edit_url. They review the draft there and press "Send to client" to get the live client link.' });
  });

  server.registerTool('update_quote', {
    title: 'Revise a quote',
    description: 'Changes an existing quote. Send only the fields that change; "items" replaces the whole item list, so include every line that should remain. If the client has already seen the quote, the revision goes back to draft for the user to review and re-send. Accepted quotes are locked.',
    inputSchema: {
      quote: z.string().describe('Quote number, e.g. "Q-0003".'),
      change_note: z.string().optional().describe('One line on what changed, shown in the quote history.'),
      ...Object.fromEntries(Object.entries(quoteFields).map(([k, v]) => [k, v.optional()])),
    },
  }, async ({ quote: ref, ...changes }) => {
    const quote = await Q.quoteByRef(ws.id, ref);
    if (!quote) return fail(`No quote "${ref}" in this workspace. Call list_quotes to see the numbers.`);
    try {
      const updated = await Q.updateQuote(quote, changes, 'Claude');
      return ok({ saved: true, ...summary(updated, baseUrl), next_step: 'Give the user the edit_url to review and send the revision.' });
    } catch (e) { return fail(e.message); }
  });

  server.registerTool('list_quotes', {
    title: 'List quotes',
    description: 'Lists quotes with status, totals and how often the client opened the link. Use it to answer "which quotes are still open?", "who has not replied?" or "what did I win this month?".',
    inputSchema: {
      status: z.enum(Q.STATUSES).optional().describe('Filter by status.'),
      search: z.string().optional().describe('Match on client name, title or number.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ status, search }) => {
    let rows = await Q.listQuotes(ws.id);
    if (status) rows = rows.filter((r) => r.status === status);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => `${r.client_name} ${r.title} ${r.number}`.toLowerCase().includes(s));
    }
    return ok({ count: rows.length, quotes: rows.slice(0, 100).map((r) => summary(r, baseUrl)) });
  });

  server.registerTool('get_quote', {
    title: 'Get one quote',
    description: 'Returns a quote in full: line items, totals, terms, and its history including anything the client wrote when asking for changes. Call this before revising a quote.',
    inputSchema: { quote: z.string().describe('Quote number, e.g. "Q-0003".') },
    annotations: { readOnlyHint: true },
  }, async ({ quote: ref }) => {
    const quote = await Q.quoteByRef(ws.id, ref);
    if (!quote) return fail(`No quote "${ref}" in this workspace. Call list_quotes to see the numbers.`);
    const t = Q.totals(quote);
    return ok({
      ...summary(quote, baseUrl),
      client_phone: quote.client_phone, client_email: quote.client_email, site_address: quote.site_address,
      intro: quote.intro, items: t.items, tax_pct: t.tax_pct, terms: quote.terms,
      history: (await Q.eventsFor(quote.id)).map((e) => ({ at: e.created_at, what: e.kind, by: e.actor, message: e.detail || undefined })),
    });
  });

  server.registerTool('save_rate_card_items', {
    title: 'Add or update rate card items',
    description: 'Adds items to the contractor\'s rate card, or updates the rate of items with the same name. Use it when the user shares their price list (typed, pasted, or as a photo) or says a rate has changed.',
    inputSchema: {
      items: z.array(z.object({
        name: z.string(), unit: z.string().describe('e.g. "sq ft", "rft", "nos", "lump sum"'),
        rate: z.number(), notes: z.string().optional(),
      })).min(1),
    },
  }, async ({ items }) => {
    const result = await Q.upsertRateItems(ws.id, items);
    return ok({ saved: true, ...result, rate_card_url: `${baseUrl}/app/settings#rates` });
  });

  return server;
}

export function mountMcp(app, getBaseUrl) {
  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  };
  const rpcError = (res, status, message) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

  app.options('/mcp/:key', (req, res) => { cors(res); res.status(204).end(); });

  app.post('/mcp/:key', async (req, res) => {
    cors(res);
    try {
      const ws = await Q.workspaceByKey(req.params.key);
      if (!ws) return rpcError(res, 404, 'Unknown PakkaQuote link. Copy the Claude link again from your PakkaQuote dashboard.');
      const server = buildServer(ws, getBaseUrl(req));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('mcp error', e);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
  });

  // Stateless server: no standalone event stream and no sessions to end.
  const notAllowed = (req, res) => { cors(res); res.setHeader('Allow', 'POST'); rpcError(res, 405, 'Method not allowed. Use POST.'); };
  app.get('/mcp/:key', notAllowed);
  app.delete('/mcp/:key', notAllowed);
}
