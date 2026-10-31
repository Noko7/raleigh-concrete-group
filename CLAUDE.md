# Working rules for this repository

## Senior review before every merge

No pull request is merged until a senior reviewer has signed off on it. The reviewer is a separate agent
briefed as a senior engineer with many years of experience reviewing junior engineers' work. It is
given the PR's goal (the user's request, in their words), the diff, and the files it touches. It reports:

1. **Requirements**: does the change do exactly what was asked, nothing missing and nothing extra?
2. **Regressions**: anything it breaks or changes for owners, contractors or customers (pages, texts,
   payments, receipts, permissions/RLS, migrations, money arithmetic).
3. **Correctness**: bugs, edge cases, security (RLS, escaping, auth, secrets), data integrity.
4. **Verdict**: approve, or the blocking findings with file:line.

Blocking findings are fixed and re-reviewed before merging. The verdict is summarized to the user
before the merge happens. This applies to every PR, however small.

## Other conventions

- Database changes ship as a migration in `supabase/migrations` with `undo/` and `verify/` siblings,
  dry-run against production in a rolled-back transaction, and `supabase/schema.sql` updated by hand.
- Run `npm run typecheck`, `npm run lint` and `npm test` before pushing.
- API keys (DocuSeal, Stripe, Quo, Supabase) live in Vercel environment variables only. Never commit
  them or paste them into chat.
