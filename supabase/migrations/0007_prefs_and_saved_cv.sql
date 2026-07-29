-- User-level preferences that outlive a single generation.
--
-- default_template: the design the user last DOWNLOADED. View prefs live on
-- generations (0004) because they describe one document; this describes the
-- user, so every future generation can start in the design they already chose
-- instead of resetting to 'classic'. Nullable = "never downloaded anything
-- yet". Validated against CV_TEMPLATES in code rather than a check constraint,
-- since the template list changes far more often than the schema.
--
-- cv_file_name / cv_uploaded_at: metadata for the base CV already stored in
-- raw_cv_text (0001), so the upload step can offer it back by name instead of
-- making a returning user find and re-upload the same document. The file
-- itself is still never stored — only its extracted text.

alter table public.profiles
  add column if not exists default_template text,
  add column if not exists cv_file_name text,
  add column if not exists cv_uploaded_at timestamptz;
