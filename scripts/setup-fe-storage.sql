-- ─────────────────────────────────────────────────────────────────────────────
-- Setup Supabase Storage bucket for Feature Engineering models (fe-models)
-- Run in Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create the bucket (public: false — access via RLS only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('fe-models', 'fe-models', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow authenticated users to read their own files
CREATE POLICY "fe_models_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'fe-models' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Allow authenticated users to insert their own files
CREATE POLICY "fe_models_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'fe-models' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Allow authenticated users to update their own files
CREATE POLICY "fe_models_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'fe-models' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Allow authenticated users to delete their own files
CREATE POLICY "fe_models_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'fe-models' AND (storage.foldername(name))[1] = auth.uid()::text);
