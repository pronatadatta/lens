// ============================================================
// Lens — public runtime config
// ============================================================
// Loaded as a plain <script> (no bundler, no build step — Lens ships as
// static files that Vercel serves as-is per vercel.json's
// outputDirectory: "public"). Every other page (index.html, view.html)
// includes this BEFORE the Supabase JS CDN script and before its own
// inline script, so window.SUPABASE_* is guaranteed to exist by the
// time app code runs:
//
//   <script src="config.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script> /* app code, reads window.SUPABASE_URL etc. */ </script>
//
// SECURITY NOTE: the Supabase anon key is DESIGNED to be public — it is
// not a secret. Every request it makes is governed by the Row Level
// Security policies defined in setup.sql (anon: select/insert/update/
// delete on public.photos and storage.objects, scoped to the 'lens'
// bucket). Never put a service_role key in client-side code.
//
// Replace the two placeholder values below with your project's own
// (Supabase Dashboard → Settings → API → Project URL / anon public key).
// ============================================================

window.SUPABASE_URL = "https://hyycnbjoxqnkpicjptap.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eWNuYmpveHFua3BpY2pwdGFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NjIzMTYsImV4cCI6MjEwMTUzODMxNn0.rU1JBjuY6s3GlIGmSn_Ueqx-5AbAdbOQUIYiLsuzIHU";

// Matches the bucket id created in setup.sql (insert into storage.buckets).
window.SUPABASE_BUCKET = "lens";
