# PakkaQuote

Quotes for painting and renovation contractors. The contractor's own Claude writes the quote over MCP.
This app saves it, lets a person edit it, hosts the client link, and records the client's answer.

**No AI inside.** No model calls, no AI keys, no AI SDKs. Run `grep -ri "openai\|anthropic" --exclude-dir=node_modules .` to check: the only hits are this README.

## What each side does

| Claude (customer's own plan) | PakkaQuote (this app) |
| --- | --- |
| Reads site notes, WhatsApp text, photos of measurement sheets | Stores the business profile and rate card |
| Picks items from the rate card and writes the quote | Numbers quotes, does subtotal, discount, GST and total |
| Rewrites a quote when the client asks for a change | Editor for a person to fix anything |
| | Live client link: accept by name, or ask for a change |
| | View tracking, history, locking once accepted |

## MCP tools

`get_business_context` · `create_quote` · `update_quote` · `list_quotes` · `get_quote` · `save_rate_card_items`

Endpoint: `POST /mcp/<workspace key>` (Streamable HTTP, stateless). Each workspace has its own link, shown on its dashboard.

## Run locally

```bash
npm install
npm start            # http://localhost:3000, embedded database in ./data
BASE=http://localhost:3000 npm test   # full loop: MCP create -> edit -> send -> client change -> accept
```

Demo login: `demo@pakkaquote.app` / `pakka-demo`

## Deploy (Render, about 5 minutes)

1. Push this folder to a GitHub repo.
2. Render dashboard -> **New** -> **Blueprint** -> choose the repo -> **Apply**. `render.yaml` creates the web service and a Postgres database and wires them together.
3. Open the service URL, log in with the demo account, copy the Claude link from the dashboard.

Free-plan limits to know about:
- The free web service sleeps after 15 minutes idle and takes about a minute to wake. Claude may time out on that first call. Either set `plan: starter` in `render.yaml`, or point a free uptime pinger at `/healthz` every 10 minutes.
- The free Postgres database expires 30 days after creation.

Any Node host works. Without `DATABASE_URL` the app falls back to an embedded database on local disk, which most free hosts wipe on restart, so set `DATABASE_URL` in production (Render, Neon, Supabase).

| Env var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Signs login cookies |
| `PUBLIC_URL` | Optional. Force the base URL used in links |
| `DEMO_EMAIL`, `DEMO_PASSWORD`, `HIDE_DEMO` | Optional. Demo workspace settings |
| `PGSSL=no-verify` | Optional. For Postgres hosts with self-signed certificates |

## Connect it to Claude

1. In Claude: **Settings -> Connectors -> Add custom connector**.
2. Name: `PakkaQuote`. URL: the Claude link from your PakkaQuote dashboard (`https://<your-app>/mcp/<key>`). Add it. There is no sign-in step.
3. In a new chat, switch PakkaQuote on from the **+** menu under Connectors.
4. Ask: *"Make a quote for Arjun Rao, 2BHK interior repaint at Indiranagar, about 1,200 sq ft of walls, plus terrace waterproofing 600 sq ft. 5% off as he is a repeat client."*
5. Open the edit link Claude gives you. Change a line. Press **Send to client**. Open the client link in a private window and accept it.

## Layout

```
server.js          routes: pages, JSON API, client link
src/mcp.js         the six MCP tools
src/quotes.js      domain logic and all arithmetic
src/db.js          Postgres / embedded Postgres, schema
src/views.js       server-rendered pages
public/            css + small editor scripts
test/e2e.mjs       end-to-end test using a real MCP client
```
