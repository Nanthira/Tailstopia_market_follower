# Market History, Item Trash, and Image Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only price history removal, three-day recoverable item Trash, and compact WebP uploads without pushing to GitHub.

**Architecture:** Keep `price_reports` as the source of truth and mark removed rows with status `removed`. Add `item.deleted_at` for recoverable card deletion; lazily purge expired items, their cascading report rows, and their Supabase Storage image during authenticated admin listing/Trash requests. Resize/compress selected images in the browser before existing server upload.

**Tech Stack:** React, TypeScript, Express, Supabase Postgres/Storage, Vite.

**Spec:** `docs/superpowers/specs/2026-10-31-market-history-trash-and-image-design.md`

## Global Constraints

- No public member price submission.
- No seller name or seller account collection.
- No change to the rule that a one-currency report is converted for display using the current rate, while a report containing both currencies keeps both entered values.
- No GitHub push or production deployment without the user's explicit consent.
- New photos: WebP, at most 1200 pixels on the longest edge, quality 0.80.
- Item Trash recovery period: three days.

## Review Focus

- Removed historical rows must never contribute to public ranges or common-price counts; configure report aggregation to use only approved rows.
- Repeated equal prices must count only their currently approved rows; display counts by exact entered-price pair/currency and keep each row independently removable.
- Expired items must not be restorable even if lazy cleanup has not yet run; reject expired restore requests and perform cleanup.
- Only Storage objects inside the configured `item-images` bucket may be deleted; external/legacy image URLs must not be treated as object keys.
- Unauthorized requests must not remove reports, items, or images; require the existing admin session on every mutation and Trash endpoint.

---

### Task 1: Add the database fields for report removal and recoverable item deletion

**Files:**
- Modify: `supabase/setup.sql`
- Modify: `docs/superpowers/specs/2026-10-31-market-history-trash-and-image-design.md` only if implementation details change

**Interfaces:**
- Produces: nullable `public.item.deleted_at timestamptz` field; no new history table or seller fields.
- Reuses: `public.price_reports.status` with `removed` value; existing item-to-report `ON DELETE CASCADE` relationship.

- [x] Add an idempotent `ALTER TABLE public.item ADD COLUMN IF NOT EXISTS deleted_at timestamptz` statement.
- [x] Document that admins must run updated `supabase/setup.sql` in Supabase SQL Editor before deploying/running the new application version.
- [x] Review the SQL diff to ensure existing rows and report statuses are preserved.

### Task 2: Add protected report removal, item Trash, restore, and purge APIs

**Files:**
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: existing `currentAdmin(req)` authentication, Supabase client, and item image URLs.
- Produces:
  - `DELETE /api/reports/:reportId`: set a pending or approved report status to `removed`; do not delete the row.
  - `DELETE /api/items/:itemId`: set `item.deleted_at` to current time.
  - `GET /api/trash`: return trashed items for admins after running expiry cleanup.
  - `POST /api/trash/:itemId/restore`: restore only items within three days; reject expired items and purge them.
  - `DELETE /api/trash/:itemId`: permanently purge a trashed item and its image.
- Public listing API: omit items where `deleted_at` is not null and expose only approved reports.
- Admin listing API: include only live items and their pending reports; Trash is read from its dedicated endpoint.

- [x] Add helper to parse only a public Storage URL belonging to this Supabase project's `item-images` bucket; return no object key for external URLs.
- [x] Add idempotent expiry cleanup: select rows where `deleted_at <= now() - interval '3 days'`, remove bucket objects when present, then delete item rows so report foreign keys cascade.
- [x] Run expiry cleanup on authenticated admin listings and Trash reads; ensure cleanup/storage errors are surfaced and prevent falsely reporting a successful purge.
- [x] Implement admin-only report removal, accepting only current pending/approved rows and setting `status = 'removed'`.
- [x] Implement admin-only item soft deletion, trash listing, in-window restore, and immediate permanent purge. Ensure an expired item cannot be restored before cleanup.
- [x] Exclude trashed items and removed reports from all public/admin active listing calculations.
- [x] Review API responses and errors to avoid exposing secret keys or database internals.

### Task 3: Add price history and deletion controls to admin UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: Task 2 report history and Trash endpoints.
- Produces: item configuration view with report rows/statuses, active equal-price counts, per-report removal, item-to-Trash action, and admin Trash restore/permanent-delete actions.

- [x] Extend `Item`/`Report` types and admin data loading so configuration can display each report's raw nullable currency values, source, status, and submission date.
- [x] In item configuration, show approved price counts grouped by exact recorded currency values; count only status `approved`, and provide removal per report row so equal-price reports are independently removable.
- [x] Show pending, rejected, and removed records in a clearly labeled history section; show Remove for eligible pending/approved rows and no active price count for removed rows.
- [x] Add a confirmed action to move an item card into Trash; include a clear explanation that it can be restored for three days.
- [x] Add an admin Trash area showing expiry time and per-item Restore and permanently Delete actions, each with confirmation for permanent deletion.
- [x] Refresh active listings and counts after each successful mutation; keep current admin-only access and responsive styling.

### Task 4: Resize and compress new item photos before upload

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/style.css` only if upload feedback/preview requires styling
- Modify: `server/app.ts` only if the existing WebP validation needs a safe adjustment

**Interfaces:**
- Consumes: existing admin upload route and upload preview callbacks.
- Produces: a WebP data URL no larger than 1200 px on its longest edge, encoded with quality `0.80` before POST to `/api/uploads/image`.

- [x] Convert the selected image using browser decoding and canvas; preserve aspect ratio and skip upscaling images already under the dimension limit.
- [x] Encode as `image/webp` at quality `0.80`; show a clear upload error if decode, canvas conversion, or encoding fails.
- [x] Keep a 5 MB source-file guard and ensure the server accepts the resulting WebP while retaining its upload byte limit.
- [x] Keep the existing preview behavior and show upload-in-progress state during conversion and transfer.

### Task 5: Document deployment and verify local behavior

**Files:**
- Modify: `README.md`

- [x] Document running the updated setup SQL before using the new APIs, Trash lifecycle, price statuses, and image conversion behavior.
- [x] Run `npm run build` and resolve any compile/build failures.
- [ ] Manually verify: pending report removal disappears from queue but remains in history; approved report removal reduces range/count; re-approving a later equal price counts once; item restore within three days restores active approved rows; expired/immediate purge removes the item and its owned image; external URLs are preserved; non-admin mutations receive 401.
- [x] Review `git status` and diff; leave all changes local and do not commit, push, or deploy.
