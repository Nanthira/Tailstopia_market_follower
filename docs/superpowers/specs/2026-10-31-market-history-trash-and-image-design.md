# Market history, item trash, and image storage design

## Intent

Give admins precise controls over item cards and individual price reports while preserving useful history and keeping uploaded images compact.

## Goals

- Let admins configure item details and see the item's price reports/history.
- Let admins remove an individual price report from the live market without erasing its record.
- Keep report status in the existing `price_reports` table; do not collect seller identities or create a separate price-history table.
- Let admins move an item card to a recoverable Trash for three days, restore it, or permanently delete it.
- Resize/compress new item photos before uploading them to Supabase Storage.

## Price report behavior

- Use existing statuses `pending`, `approved`, and `rejected`; add `removed` for reports excluded from the live market.
- Public ranges, common-price counts, and approved report counts use only `approved` rows.
- Removing an approved report changes its status to `removed`; it remains visible in admin history with its existing price, source, and creation time.
- A later report with the same price is a separate row. Once approved, it counts once; earlier `removed` rows never contribute to its count.
- Admin configuration shows report records and current included counts. Remove applies to a specific report row, not every report with the same value.
- Admins may remove pending queue entries by marking them `removed`; this hides them from the pending queue and preserves the record.

## Item Trash behavior

- Add a nullable deletion timestamp to `item`; setting it moves the card and its associated report history into Trash without deleting either.
- Active listing and pending queue APIs omit items in Trash. The admin Trash view shows the deletion time and remaining recovery window.
- Restore clears the deletion timestamp; reports retain their individual statuses, so `approved` rows return to live market calculations and `removed` rows remain excluded.
- After three days, permanently purge the trashed item, its report rows, and its stored image. Run cleanup when the server handles an admin listings/Trash request; an item past expiry is not recoverable after that cleanup runs.
- Permanent deletion is also available to an admin immediately, with a confirmation step.

## Image handling

- Keep the existing admin-only upload and public item image bucket.
- Before upload, resize photos to at most 1200 pixels on the longest edge and encode as WebP at a visually reasonable quality (initial target: quality 0.80).
- Keep a sensible source file-size limit and report a clear error if the browser cannot decode or resize the selected image.
- This affects new uploads only; existing Storage objects are left as-is.

## Approaches considered

1. **Reuse report status and soft-delete items (recommended):** the current schema stays recognizable; add `removed` report status and an item deletion timestamp. Price history remains in `price_reports`.
2. **Separate current prices and immutable history tables:** more explicit audit model, but duplicates data and requires larger changes to the current approval and aggregation flow.
3. **Hard-delete reports/items immediately:** simple but loses price history and makes accidental card deletion unrecoverable.

The selected direction is approach 1, based on the user's preference to retain removed prices and recover deleted cards for three days.

## Non-goals and constraints

- No public member price submission.
- No seller name or seller account collection.
- No change to the rule that a one-currency report is converted for display using the current rate, while a report containing both currencies keeps both entered values.
- No GitHub push or production deployment without the user's explicit consent.

## Approved implementation defaults

- Expired Trash is purged on the next authenticated admin listings/Trash request after the three-day deadline; expired items cannot be restored.
- New images are converted to WebP at quality 0.80 with a 1200 px maximum longest edge.
