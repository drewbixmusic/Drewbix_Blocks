# RF Models Storage Setup

RF models (trees + metadata) are stored in **Supabase Storage** instead of the `flows` table so the database stays lightweight and responsive.

## One-time setup

1. In Supabase Dashboard: **Storage** → **New bucket**
   - Name: `rf-models`
   - Public: **No**

2. In **SQL Editor**, run `scripts/setup-rf-storage.sql` to add RLS policies so users can read/write their own RF files.

## Behavior

- **Save flow**: Flow document (nodes, edges, config) goes to `flows` table; RF models go to Storage at `{userId}/{flowName}.json`
- **Load flow**: Flow from `flows`; RF models from Storage. If Storage fails (e.g. bucket missing), falls back to `rf_models` in the flow document (backward compatible)
- **trainRows** are never persisted (too large); Merge mode starts fresh after reload
