# Supabase Setup

1. Rotate the exposed secret key before doing anything else.
2. Copy `.env.example` to `.env` and fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. In Supabase SQL Editor, run `supabase/schema.sql`.
4. Enable email magic link auth in Supabase Auth.
5. Create the `course-files` storage bucket if the SQL insert does not apply automatically in your project.

Important:
- Do not place the Supabase secret key in the frontend app.
- The frontend uses only the publishable key.
- The current production pass uses deterministic parsing and grounded study logic. AI provider integration is intentionally left pluggable.
