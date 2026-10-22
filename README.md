# Premium Watch

A private dashboard that tracks the **mNAV** of public crypto-treasury companies: how much the
market pays per unit of crypto each company holds, how that premium moves, and whether the company
grows its coins per share. It emails an alert when a premium crosses a threshold, compresses, or
goes below 1.

Seeded with Strategy (MSTR), Metaplanet (3350, Tokyo), Upexi (UPXI) and DeFi Development (DFDV).
BTC, SOL and ETH treasuries are supported, and companies are added in the admin UI.

```
shared/     pure calculations (mNAV, dilution, coin yield, ledger as-of, stale detection, alert rules,
            CSV parsing) + Firestore types. No I/O. Vitest.
job/        Cloud Run job: fetches prices, writes daily snapshots, evaluates alerts. Also the backfill CLI.
api/        Cloud Run service (Hono): serves the web app, the admin API, and the Firebase auth proxy.
web/        Vite + TypeScript, no framework. Lightweight Charts. Firebase Auth (Google) + Firestore reads.
firestore/  security rules template, indexes, rules tests (Firestore emulator).
```

Everything runs in **europe-north1**, except the Cloud Scheduler triggers. Scheduler isn't
offered there, so they live in europe-west1 and start the job in europe-north1.

## How the numbers are calculated

All values are in USD. A JPY company's share price, debt, preferred and cash are converted with the
USD/JPY rate at the same snapshot.

| Metric | Formula |
|---|---|
| NAV | coins held × coin spot price |
| mNAV (basic) | price × basic shares ÷ NAV |
| mNAV (diluted), the default | price × fully diluted shares ÷ NAV |
| mNAV (EV) | (price × basic shares + debt + preferred at liquidation value − cash) ÷ NAV |
| Coins per share | coins ÷ basic shares, coins ÷ diluted shares |
| Coin yield (30/90/365d) | % change in coins per diluted share between date − N days and date, both read from the ledger |

- A missing debt, preferred or cash entry counts as 0 and is listed in the snapshot's `assumedZero`.
- Historical prices are **unadjusted** for later splits, so a past price matches the share count
  filed at that time. EODHD's `close` is raw. Yahoo's chart is split-adjusted, so the provider
  un-adjusts it with Yahoo's split events.
- The close snapshot uses the coin spot price nearest the exchange's closing bell: 16:00 New York,
  15:30 Tokyo.

## Data sources

| Data | Source | Notes |
|---|---|---|
| Crypto spot | CoinGecko public API | No key needed; an optional free demo key (`COINGECKO_API_KEY`) raises the rate limit. |
| Nasdaq/NYSE prices, USD/JPY, crypto history | **EODHD**, "Historian" plan (EOD only, $19.99/mo, 100k calls/day) | Covers US exchanges, FOREX and crypto. |
| Tokyo Stock Exchange prices | **Yahoo Finance** via `yahoo-finance2` | Free and unofficial. EODHD has **no** Tokyo coverage on any plan (checked 2026-10-22: Japan is absent from its exchange list and `/exchange/TSE` returns 404). |
| Holdings, shares, debt, preferred, cash | Your manual ledger | Entered in the admin UI or by CSV, each entry with a source URL. |

Providers sit behind `MarketDataProvider` and are routed per exchange by env:
`MARKET_DATA_PROVIDER` (default), `MARKET_DATA_PROVIDER_TSE`, `FX_PROVIDER`, `CRYPTO_HISTORY_PROVIDER`.
Each can be `eodhd`, `yahoo` or `fake`. You can drop EODHD entirely by setting all of them to
`yahoo`, which costs nothing but relies on an unofficial API.

## Local development

Needs Node ≥ 22.18 and Java 21 for the emulators (`brew install openjdk@21`; the npm scripts add
`/opt/homebrew/opt/openjdk@21/bin` to PATH).

```sh
npm install
npm run dev            # emulators (Firestore, Auth, UI on :4000) + api on :8787 + web on :5173
npm run seed:dev       # in another terminal: 4 companies, a made-up demo ledger, a dev owner account
npm run backfill:dev -- --from 2025-01-02
open http://localhost:5173   # "Sign in with Google" → pick owner@example.com in the emulator popup
```

Dev uses the `fake` market data provider (deterministic prices). `npm run job:dev -- --mode close
--market all` runs one job pass. To try real prices against the emulator, prefix with
`MARKET_DATA_PROVIDER=yahoo SPOT_PROVIDER=coingecko`. Emulator data is saved to
`emulator-data/` on exit.

```sh
npm test               # shared + job unit tests, api + rules tests inside the Firestore emulator
npm run build
```

## Ledger

Each ledger entry **sets** a value from its effective date onward; it is not a delta. The state on
any date is the latest entry per type on or before that date. When two entries share a date, the
one created later wins, which is how you make a correction.

| type | unit |
|---|---|
| `holdings` | coins |
| `shares_basic`, `shares_diluted` | shares (as reported then, not split-adjusted) |
| `debt`, `preferred` (liquidation value), `cash` | money in the company's currency (JPY for Metaplanet) |

### CSV import format

UTF-8, header row required, `note` optional, quote fields that contain commas. Thousand separators
inside quotes are fine. The import is all-or-nothing: any bad row (with its line number) means
nothing is written. **Validate** runs a dry run first.

```csv
companyId,effectiveDate,type,value,sourceUrl,note
mstr,2026-10-20,holdings,640031,https://www.strategy.com/press/...,8-K
mstr,2026-10-20,shares_diluted,"312,000,000",https://www.sec.gov/...,10-Q
metaplanet,2026-09-30,debt,15000000000,https://metaplanet.jp/en/shareholders/disclosures,"JPY, bonds"
```

The same CSV can be imported from the terminal (same checks, all-or-nothing):
`npm run import-ledger -- data/ledger/2026-10-23.csv [--dry-run]`. Imported files are kept in
`data/ledger/` as a record of what was entered and where it came from.

Snapshots are immutable once final. After entering **historical** ledger rows, rebuild the
affected days:

```sh
npm run backfill -- --from 2025-01-01 --company mstr --force
```

## Adding a company

Go to Admin → Companies → Add, and give it an id (lowercase, used in URLs), name, ticker
(`MSTR`, or `3350` for Tokyo), exchange (Nasdaq, NYSE, TSE), currency and treasury asset. Then add
ledger entries (at least `holdings`, `shares_basic` and `shares_diluted`) and backfill its history.
No code changes are needed. A new exchange or currency would need one line in
`shared/src/exchanges.ts`.

## Jobs, snapshots and alerts

- **Daily close.** Two Cloud Scheduler triggers: Tokyo at 17:00 JST and US at 18:30 New York
  time, Monday to Friday. Each run re-examines the last 4 sessions and writes every snapshot that
  is missing or not final. Exchange holidays (a weekday with no bar while later bars exist) are
  skipped.
- **Final** means the day's own close is in and nothing is stale. Final snapshots are never
  rewritten. Rerunning the same day gives the same snapshot, and an identical one isn't rewritten.
- **Stale.** If holdings or shares are missing from the ledger, or a price or FX rate is more
  than 1 trading day old, or the spot price more than 1 day old, the snapshot is still written,
  with `stale: true` and the reasons in `missing`. Stale snapshots stay non-final and are not
  used for alerts.
- **Intraday** (`INTRADAY_ENABLED=true`): every 30 minutes during trading hours, it overwrites
  today's snapshot until the close run finalises it.
- **Alerts:** diluted/basic/EV mNAV below X, above X, or down more than X% over N days. "Below
  1.0" is "below X" with X = 1. An alert fires when its condition becomes true and stays quiet
  until the condition has been false again. Email goes through Resend, with the values and a
  link to the company page.

Holidays are not in a calendar; the trading-day rules count weekdays.

## Deploying

Run the console steps once, then the commands. All gcloud commands read `config/deploy.env`
(copy it from `config/deploy.env.example`).

### One-time console steps

1. **Google Cloud project** with billing enabled: <https://console.cloud.google.com/projectcreate>.
2. **Add Firebase** to that project: <https://console.firebase.google.com> → Add project → choose
   the existing Cloud project.
3. **Firestore**: Firebase console → Firestore Database → Create database → **Production mode**
   → location **europe-north1**. The database id must be `(default)`.
4. **Google sign-in**: Firebase console → Authentication → Get started → Sign-in method →
   Google → Enable.
5. **Web app config**: Firebase console → Project settings → Your apps → Add app (Web). Copy
   `apiKey` and `appId` into `config/deploy.env`.
6. **Accounts**: EODHD (Historian plan) for the API key; Resend for an API key.
7. **Secrets** (gcloud prompts for the value on stdin; paste it, then Ctrl-D):
   ```sh
   gcloud secrets create eodhd-api-key --project=$PROJECT_ID --replication-policy=user-managed --locations=europe-north1 --data-file=-
   gcloud secrets create resend-api-key --project=$PROJECT_ID --replication-policy=user-managed --locations=europe-north1 --data-file=-
   ```

### Deploy

```sh
gcloud auth login && gcloud config set project $PROJECT_ID
npx firebase login
npm run deploy:setup       # APIs, Artifact Registry, service accounts and their roles
npm run deploy:rules       # Firestore rules (owner-only reads, no client writes) + indexes
npm run deploy:api         # builds on Cloud Build (amd64), deploys the service, prints its URL
```

After the first API deploy:

1. Put the printed URL in `APP_URL`.
2. Firebase console → Authentication → Settings → **Authorized domains** → add the
   `*.run.app` host.
3. Google Cloud console → APIs & Services → Credentials → the "Web client (auto created by
   Google Service)" OAuth client → **Authorized redirect URIs** → add
   `https://<run.app host>/__/auth/handler`. The app proxies Firebase's auth handler on its own
   domain so sign-in works in Safari.
4. Sign in once. Then copy your uid (Firebase console → Authentication → Users) into
   `OWNER_UID`, and run `npm run deploy:rules && npm run deploy:api` again. Until then every
   sign-in is refused.

```sh
npm run deploy:job
npm run deploy:scheduler
npm run job:run            # run the job once now and wait
```

`npm run deploy` runs rules → api → job → scheduler.

### Backfill against production

```sh
gcloud auth application-default login     # once; the CLI writes to Firestore as you
npm run backfill -- --from 2024-01-01 [--company mstr] [--force] [--dry-run]
```

Note that CoinGecko's public API only reaches back 365 days. Backfill therefore takes crypto
history from `CRYPTO_HISTORY_PROVIDER` (EODHD by default): the UTC daily close nearest the
exchange close.

### What runs where

| Piece | Identity | Roles |
|---|---|---|
| Service `premium-watch` (min 0, max 1, 1 vCPU, 256 MiB) | `pw-api` | Firestore user, Firebase Auth viewer |
| Job `premium-watch-job` (15 min timeout, 1 retry, 512 MiB) | `pw-job` | Firestore user; secret accessor on the two secrets only |
| Scheduler triggers (europe-west1) | `pw-scheduler` | Run jobs with overrides, on this job only |

The triggers call the Cloud Run Admin API (`run.googleapis.com`) with an **OAuth** token.
Google APIs take OAuth access tokens; OIDC tokens are for calling a Cloud Run service URL
directly.

Logs: Cloud Run → premium-watch-job → Logs. Each run ends with one JSON line: written,
unchanged, stale, alertsFired, errors.
