# supabase/archive

**Never re-run these files.** They describe how the database got to where it is.
The live state is in `../migrations/` (changes since 2026-10-17), `../schema.sql`
(the whole public schema, generated from the live catalog) and `../snapshots/`.

Every file here was checked against the production catalog on 2026-10-17: all of
them are fully live (every column, table, index, policy and grant they create is
there, or was later replaced by a newer file on purpose).

## Order they were applied

Most were pasted into the Supabase SQL Editor, so the database has no record of
them. The order below is rebuilt from the "run this AFTER" notes, git history and
the few that also left a row in `supabase_migrations.schema_migrations` (version
in brackets).

1. `schema.sql` - leads table, quote-uploads bucket
2. `crm.sql` - staff, CRM columns, activity log, integrations, login log
   (its pipeline went through two earlier forms: [20260611014058], [20260611125827])
3. `agreements.sql`, `invites.sql`, `invite-tracking.sql`, `locale.sql`,
   `quote-detail.sql`, `hourly-reminders.sql`, `manual-quote.sql`
4. `scheduling.sql`, `scheduled-time.sql`, `crew-reminders.sql`, `appointments.sql`
5. `quote-options.sql`, `quote-packages.sql`
6. `message-log.sql`, `quiet-hours.sql`, `cancel-held-text.sql`, `queue-retry.sql`
7. `payments.sql`, `test-data.sql`, `least-privilege.sql`
8. `quote-type-plans.sql`, `quote-ttl-10-days.sql`
9. `funnel.sql` [20260923041119], `lead-idempotency.sql` [20260923043128],
   `quote-drafts.sql` [20260924010139]
10. `change-orders.sql` [20261001235600], `payment-corrections.sql` [20261001235614]
11. `change-order-lines.sql`, `change-deposit.sql`
12. `fee-waiver.sql` [20261017124527], `crew-views.sql`
13. Then stage 1 [20261017221826] and stage 3 [20261017222017], now in `../migrations/`.

## Destructive to re-run

These would undo later work, fail, or rewrite customer rows:

| File | What re-running it would do today |
| --- | --- |
| `schema.sql` | Puts `qr_chk` back without the `'plans'` quote type (fails if a plans lead exists). |
| `crm.sql` | Puts `qr_status_chk` back without `'approved'`; brings back the old "staff read quotes" policy (contractors see Lost and archived jobs again); runs the old status UPDATEs and the owner insert; drops stage 3's `search_path` on `touch_updated_at()`. |
| `payments.sql` | Puts `qp_chk` back without `'voided'`; gives authenticated `UPDATE` on `quote_payments` back with the "staff update payments" policy; loosens "staff insert payments". Undoes `least-privilege.sql`. |
| `least-privilege.sql` | Puts the old money guard back, undoing `fee-waiver.sql` and stage 1. |
| `fee-waiver.sql` | Puts the pre-stage-1 money guard back, undoing stage 1. |
| `change-order-lines.sql` | Creates a 2-argument `apply_change_response` next to stage 1's 3-argument one (the API cannot choose), without the deposit logic. |
| `change-deposit.sql` | Same 2-argument overload problem. |
| `scheduling.sql` | UPDATEs job status (accepted, undated, scheduled -> approved). |
| `test-data.sql` | UPDATEs `is_test` on staff and leads by name pattern. |
| `quote-ttl-10-days.sql` | UPDATEs `quote_expires_at`, reviving expired quotes. |
| `agreements.sql` | Drops stage 3's `search_path` on `touch_agreements_updated_at()` (minor). |
| `manual-quote.sql` | Fails: its `create policy` has no `drop ... if exists` for the same name. |

The rest only add columns, tables, indexes or policies that already exist, so
re-running them changes nothing - but there is still no reason to.
