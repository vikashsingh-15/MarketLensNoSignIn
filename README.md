# MarketLens

MarketLens is a clean MERN portfolio application that turns publicly reported analyst calls into deduplicated, stock-level intelligence. It collects articles from enabled RSS publishers, uses Cerebras to extract explicit broker recommendations, normalizes stocks and brokers, and calculates consensus with ordinary application code.

> MarketLens aggregates publicly reported analyst and broker recommendations for informational purposes only. It does not provide personalized investment advice. Always verify information with the original source before making investment decisions.

## Stack

- Client: React 19, TypeScript, Vite, React Router, Axios, Recharts, Lucide
- Server: Node.js, Express, TypeScript, MongoDB, Mongoose
- Authentication: Passport Google OAuth, Express sessions, MongoDB session store
- Ingestion: Agenda, `rss-parser`, Axios, Cheerio
- Extraction: official Cerebras Node.js SDK and Zod validation

## Structure

```text
marketlens/
├── client/    # Vite React application
├── server/    # Express API, models, jobs, services, and live-data setup
├── package.json
└── README.md
```

## Quick start

Prerequisites: Node.js 20+, npm, and a local or hosted MongoDB database.

1. Install dependencies:

   ```bash
   npm run install:all
   ```

2. Create environment files:

   ```powershell
   Copy-Item server/.env.example server/.env
   Copy-Item client/.env.example client/.env
   ```

   On macOS/Linux, use `cp` instead of `Copy-Item`.

3. Add Google OAuth credentials and a strong `SESSION_SECRET` to `server/.env`. Add a Cerebras key to enable live article extraction.

4. Ensure MongoDB is running, then initialize stocks, brokers, and real RSS publishers:

   ```bash
   npm run init:data
   ```

5. Collect live articles and recommendations immediately:

   ```bash
   npm run ingest
   ```

6. Start both apps:

   ```bash
   npm run dev
   ```

Open `http://localhost:5173`. The API runs at `http://localhost:8000`.

The initialization command upserts curated aliases, brokers, and real RSS publishers. Startup then reconciles the full official NSE equity master. It never creates articles or recommendations; those come only from live ingestion.

## Stock-master lifecycle

MarketLens downloads the official NSE equity master, symbol-change history, and company-name history at startup and every weekday. Stocks are reconciled by ISIN rather than treating a mutable ticker as permanent identity.

- Symbol changes preserve old tickers in `symbolHistory` and aliases.
- Superseded records remain available for historical recommendations but are excluded from live scans.
- A stock missing from one validated master is held for confirmation; two consecutive misses mark it inactive.
- Incomplete or unexpectedly small NSE downloads never deactivate existing stocks.
- Quote-provider failures, insufficient candle history, and temporary network errors have separate statuses and retry windows.

Run a manual reconciliation with `npm run stocks:sync`. Authenticated users can inspect current problems at `GET /api/stocks/data-health`.

## Environment variables

Server (`server/.env`):

```env
PORT=8000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/marketlens
SESSION_SECRET=replace-with-a-long-random-value
CLIENT_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:8000/api/auth/google/callback
CEREBRAS_API_KEY=
CEREBRAS_MODEL=gpt-oss-120b
RSS_DEV_INTERVAL=false
RSS_RUN_ON_STARTUP=true
```

Client (`client/.env`):

```env
VITE_API_URL=http://localhost:8000/api
```

`RSS_RUN_ON_STARTUP=true` queues an ingestion pass whenever the backend starts. Agenda also runs market-news and recommendation collection every 15 minutes while the backend is online. Corporate-calendar and NSE stock-master jobs have separate weekday schedules in `server/src/config/agenda.ts`.

## Google OAuth setup

1. Create a project in Google Cloud Console.
2. Configure its OAuth consent screen.
3. Create an OAuth 2.0 Client ID of type **Web application**.
4. Add `http://localhost:5173` as an authorized JavaScript origin.
5. Add `http://localhost:8000/api/auth/google/callback` as an authorized redirect URI.
6. Copy the client ID and client secret into `server/.env`.

The browser starts at `GET /api/auth/google`. After Google returns to the callback, Passport finds or creates the MongoDB user, saves its ID in the MongoDB-backed session, and redirects to `/dashboard`. Axios sends cookies using `withCredentials: true`.

## Cerebras extraction

Create an API key in Cerebras Inference Cloud and set `CEREBRAS_API_KEY`. The reusable client lives in `server/src/services/ai/cerebras.service.ts`; no AI client is initialized elsewhere.

The service requests JSON mode, explicitly distinguishes publishers from brokers, and asks only for company/ticker, broker, BUY/HOLD/SELL, current/previous targets, and confidence. The returned JSON is parsed and validated with Zod before normalization or storage. Missing credentials or an invalid response fails only that article; the ingestion loop continues.

## RSS ingestion flow

Agenda registers one job named `fetch-market-news`:

1. Load enabled `Publisher` records.
2. Parse each `rssUrl` independently.
3. Upsert unseen article URLs.
4. Use RSS title and description, then extract readable article text when available.
5. Send the text to Cerebras.
6. Resolve the extracted stock by ticker, company name, or alias and the broker by name or alias.
7. Store a recommendation only when both resolve.

Feed, page-fetch, Cerebras, and individual article failures are logged without stopping other sources. Publishers are maintained through reference configuration or MongoDB; there is intentionally no admin UI. Run `npm run ingest` for an immediate collection pass, or let Agenda run on schedule.

Dashboard refreshes are intentionally split. Recommendation panels scan only the current ET Markets, Moneycontrol, and Trendlyne listings; news panels run the RSS/AI pipeline; Focus for Today runs the calendar sources. Each manual request returns immediately and exposes background progress through `/api/dashboard/refresh/status`. A recommendation keeps the broker report's publication date, so a successful refresh does not change an older call to today's date when no newer validated call exists.

## Deduplication and analytics

Every record gets a unique key in this shape:

```text
TCS-JEFFERIES-BUY-4600-2026-08-15
```

The key combines normalized stock, broker, rating, target, and calendar date. A unique MongoDB index plus an atomic upsert prevents separate publisher reports of the same broker call from being counted twice.

Counts, percentages, averages, medians, broker breadth, and consensus are calculated in regular TypeScript. BUY at 60% or more produces BUY; SELL at 60% or more produces SELL; everything else is HOLD. Hot stocks are sorted only by unique broker count.

## API

Only health and authentication entry routes are public. Application routes require an authenticated session.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Service health |
| GET | `/api/auth/google` | Begin Google OAuth |
| GET | `/api/auth/google/callback` | OAuth callback |
| GET | `/api/auth/me` | Current session user |
| POST | `/api/auth/logout` | End session |
| GET | `/api/dashboard` | Summary, hot stocks, strong buys, latest calls |
| GET | `/api/dashboard/hot-stocks` | All stocks ranked by unique brokers |
| GET | `/api/dashboard/refresh/status` | Background recommendation, news, and calendar refresh status |
| POST | `/api/dashboard/refresh/recommendations` | Start current broker-listing refresh |
| POST | `/api/dashboard/refresh/news` | Start RSS and news-analysis refresh |
| POST | `/api/dashboard/refresh/calendar` | Start Focus calendar refresh |
| POST | `/api/dashboard/refresh/all` | Start every dashboard refresh in parallel |
| GET | `/api/stocks` | List stocks |
| GET | `/api/stocks/search?q=tcs` | Search stock names, symbols, aliases |
| GET | `/api/stocks/data-health` | Stock-master freshness, inactive symbols, provider errors, and candle-history gaps |
| GET | `/api/stocks/:symbol` | Stock and analytics |
| GET | `/api/stocks/:symbol/recommendations` | Stock recommendations |
| GET | `/api/recommendations` | Filterable recommendations |
| GET | `/api/recommendations/latest` | Latest recommendations |
| GET | `/api/watchlist` | Current user's watchlist |
| POST | `/api/watchlist/:symbol` | Add a stock |
| DELETE | `/api/watchlist/:symbol` | Remove a stock |

`/api/recommendations` supports `stock`, `broker`, `recommendation`, and `limit` query parameters.

## Commands

```bash
npm run install:all  # install root, server, and client dependencies
npm run dev          # run Vite and Express together
npm run build        # type-check and production-build both apps
npm run init:data    # initialize stocks, brokers, and real RSS publishers
npm run ingest       # fetch and process live RSS news immediately
npm run stocks:sync  # reconcile NSE stocks, ISINs, symbol changes, and inactive securities
npm run clean:legacy-demo # one-time removal of records from the former sample generator
```
