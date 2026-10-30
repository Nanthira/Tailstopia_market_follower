# TailsTopia market notebook

A TypeScript, React, and Node.js site for browsing item prices and moderating reports. Data is stored in your Supabase project. Reports are added by an admin through the website or by the private Discord bot. Seller names and seller accounts are not collected or stored.

## Connect your Supabase project

1. Copy `.env.example` to `.env`.
2. In Supabase, open **Connect to your project** and copy the project URL and keys into `.env`. Fill in `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; keep the secret key on the Node server only. `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_JWKS_URL` are included to match the connection panel, but this Express app does not need them for its custom username/password admin login.
3. Run `supabase/setup.sql` in the Supabase SQL Editor. It enables RLS, adds the expected foreign keys and unique admin usernames, and creates the public `item-images` Storage bucket. Review the diagram's relationships: `price_reports.item_id → item.id`, report `created_by` and `reviewed_by` → `admins.id`, and `market_settings.updated_by → admins.id`.
4. In `admins`, add your own two rows with unique usernames, bcrypt password hashes, and `is_active = true`. There is no registration page. Generate each hash using `npm run admin:hash` and paste the result into `password_hash`.
5. Set `DISCORD_BOT_SECRET` to a private random value. Give that same value only to your private Discord bot.
6. Run `npm install`, then `npm run dev`, and open the address printed by the server.

`SUPABASE_SECRET_KEY` is used only by the Express backend for database and Storage requests. Never add it to React/Vite variables, browser code, screenshots, or GitHub. The keys in `.env` are ignored by Git. The app uses `@supabase/supabase-js` because this Express backend handles its own username/password sessions; `@supabase/server` is intended for request-scoped Supabase JWT authentication in supported runtimes.

## Deploy from GitHub to Netlify

The repository includes `netlify.toml` and an Express Netlify Function for the `/api/*` routes. In Netlify, choose **Add new project → Import an existing project**, select this GitHub repository, and keep the build command as `npm run build` and publish directory as `dist` (both are set in `netlify.toml`). In **Project configuration → Environment variables**, add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DISCORD_BOT_SECRET`; make sure the variables are available to Functions, then trigger a deploy. Netlify builds do not read `.env` from Git, so enter the values in Netlify's UI. With continuous deployment enabled, later GitHub pushes trigger a new deploy.

Do not create a `VITE_` or `NEXT_PUBLIC_` version of `SUPABASE_SECRET_KEY`. The publishable key and JWKS URL are not currently needed by this server-side API. Locally, use `.env`; on Netlify, set the same server values in the Netlify environment-variable settings.

## Tables used

- `item`: `id`, `name`, `category`, `description`, `image_path`, `created_at`, `updated_at`
- `price_reports`: `id`, `item_id`, `source`, `gold_price`, `baht_price`, `status`, `created_at`, `reviewed_by`, `reviewed_at`, `created_by`
- `admins`: `id`, `username`, `password_hash`, `created_at`, `is_active`
- `market_settings`: `id`, `baht_per_1000_gold`, `updated_by`, `updated_at`

When only one currency is submitted, the other price stays SQL `NULL` and is converted for display using the current rate. If both currencies are submitted, both recorded prices are used as entered. No seller column or seller name is used.

## Discord bot bridge

`POST /api/listings/intake` accepts bot submissions and puts them in the Bot pending queue. The bot should listen only to the private channel where you forward market messages, parse the item and one or both prices, then send JSON with `Authorization: Bearer <DISCORD_BOT_SECRET>`. Example body:

```json
{
  "itemName": "Zerarite",
  "category": "Material",
  "gold": 2000,
  "baht": null,
  "description": "Forwarded market post"
}
```

The API intentionally ignores any seller fields. Admin-created prices enter the separate Admin pending queue. Approving a group updates the selected reports to `approved`; rejecting marks them `rejected`. The public cards show only approved prices.

## Run and build

```powershell
npm install
npm run dev
```

```powershell
npm run build
```

## API

- `GET /api/health` — service and Supabase connection status
- `GET /api/listings` — items with approved and pending reports
- `GET /api/settings` — Gold/baht conversion rate
- `PUT /api/settings/rate` — update the rate; admin bearer session required
- `POST /api/uploads/image` — save to Supabase Storage; admin bearer session required
- `PUT /api/items/:itemId` — configure item; admin bearer session required
- `POST /api/auth/login` and `/api/auth/logout` — admin login using `admins.username` and bcrypt `password_hash`
- `POST /api/submissions` — create an Admin pending report; admin bearer session required
- `POST /api/listings/intake` — create a Bot pending report; Discord bridge secret required
- `POST /api/review/:itemId` — approve or reject one report or all pending reports for an item/source; admin bearer session required
