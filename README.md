# TailsTopia community market demo

A TypeScript, React and Node.js prototype for a community price notebook inspired by [the 12 Tails item archive](https://12tails-items.netlify.app/). Members can browse only. Price reports enter in two ways: an admin can enter one manually, or an authenticated Discord bot can forward one. The admin dashboard separates reports into Admin request and Bot request sections, grouped by item.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install` in this folder.
3. Run `npm run dev`.
4. Open the local address printed by the server (usually `http://localhost:3001`).

The seeded catalog is sample data for the demo. Approved card prices show the minimum and maximum approved report and the most frequently submitted value for both Gold and baht. When multiple prices tie as the most common, the card shows the lowest tied price. Reports with only one currency automatically convert using the rate set in the admin dashboard. Reports that include both currencies preserve both entered amounts. Data and the selected rate are kept in memory and reset when the server restarts.

The demo has an admin login. Use **admin** / **tailstopia-demo**. Set `DEMO_ADMIN_PASSWORD` in the server environment to change the demo password. Admins can configure an item's name, category, description, and image from its card. Image uploads accept PNG, JPG, WEBP, and GIF files up to 5 MB and are stored in `public/uploads`. Sessions are in memory and sign out when the server restarts; use real user storage and authentication before production.

## Discord bridge

The demo includes an intake endpoint at `POST /api/listings/intake`. The intended bot deployment is in your private server, listening only to the configured channel where an admin forwards posts from the main Tailstopia server. It parses the forwarded item name and prices, then POSTs the report to this endpoint with a bearer secret. Each bot report appears under **Bot request**. Admin manual entries appear under **Admin request**. Both sections group by item; each group can be approved all at once, or one report at a time. Empty source sections are hidden.

For local development, set a server-side secret in PowerShell before starting the app:

```powershell
$env:DISCORD_BOT_SECRET = "your-local-demo-secret"
npm run dev
```

Example request body:

```json
{
  "itemName": "Zerarite",
  "category": "Material",
  "seller": "Forwarded by admin",
  "gold": 2000,
  "baht": null,
  "description": "Forwarded market post"
}
```

Send it with `Authorization: Bearer your-local-demo-secret`. If `DISCORD_BOT_SECRET` is missing or does not match, the intake endpoint rejects the request. The admin login uses an in-memory demo session. For production, add durable storage, production-grade authentication, image upload/storage, channel allow-listing and message validation in the bot, and rotateable service credentials. Never put a Discord bot token or the bridge secret in browser code.

## API

- `GET /api/health` — service status
- `GET /api/listings` — seeded items, approved reports, and pending reports
- `GET /api/settings` — current Gold-to-baht conversion rate
- `PUT /api/settings/rate` — change `bahtPer1000Gold`; requires the admin bearer session
- `POST /api/uploads/image` — upload an image as a base64 data URL; requires the admin bearer session
- `PUT /api/items/:itemId` — update the item's name, category, description, and uploaded image; requires the admin bearer session
- `POST /api/auth/login` — demo admin login; returns an in-memory bearer session token
- `POST /api/auth/logout` — expire the current in-memory demo session
- `POST /api/submissions` — admin manual entry; requires the admin bearer session; it creates an Admin request
- `POST /api/listings/intake` — bot report; requires `Authorization: Bearer <DISCORD_BOT_SECRET>`; it creates a Bot request
- `POST /api/review/:itemId` with the admin bearer session and `source: "Admin"` or `source: "Bot"` to approve or reject that item's source-specific queue; pass `reportId` to moderate one report

The editable Gold/baht rate and item reports live in server memory for demo purposes; they reset when the server restarts.
