-- Setup Supabase Storage for RF models (keeps flows table lightweight)
-- Run this in Supabase Dashboard > SQL Editor
--
-- FIRST: Create bucket in Dashboard > Storage > New bucket:
--   Name: rf-models
--   Public: No
--
-- THEN: Run the policies below.

-- RLS: Allow authenticated users to read/write their own files (path = userId/...)
CREATE POLICY "rf_models_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'rf-models'
  AND (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);

CREATE POLICY "rf_models_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'rf-models'
  AND (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);

CREATE POLICY "rf_models_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'rf-models'
  AND (storage.foldername(name))[1] = (auth.jwt()->>'sub')
)
WITH CHECK (
  bucket_id = 'rf-models'
  AND (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);

CREATE POLICY "rf_models_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'rf-models'
  AND (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);
