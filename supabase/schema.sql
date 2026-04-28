create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text default '',
  school text default '',
  term text default 'Fall 2026',
  energy_mode text default 'Balanced',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  title text not null,
  professor text default '',
  office_hours text default '',
  grading_weights jsonb not null default '[]'::jsonb,
  policies jsonb not null default '{}'::jsonb,
  color text default '#1f6feb',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  draft_import_id text,
  file_name text not null,
  kind text not null,
  storage_path text not null,
  mime_type text default '',
  source_type text default 'text',
  extraction_status text default 'draft',
  warnings jsonb not null default '[]'::jsonb,
  extracted_text text default '',
  snippets jsonb not null default '[]'::jsonb,
  preview text default '',
  confidence text default 'medium',
  created_at timestamptz not null default now()
);

create table if not exists public.draft_imports (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_course_id uuid references public.courses(id) on delete set null,
  course_key text not null,
  course_draft jsonb not null default '{}'::jsonb,
  document_ids jsonb not null default '[]'::jsonb,
  assignments jsonb not null default '[]'::jsonb,
  exams jsonb not null default '[]'::jsonb,
  readings jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  due_date date,
  weight numeric default 0,
  estimated_minutes integer default 90,
  priority text default 'Medium',
  source_document_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  exam_date date,
  weight numeric default 0,
  source_document_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  due_date date,
  pages text default '',
  source_document_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  due_date date,
  priority text default 'Medium',
  completed boolean not null default false,
  source_type text default 'manual',
  source_id text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  session_date date,
  duration integer default 25,
  mode text default 'Quiz me',
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_of date not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.decoder_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  due_date date,
  prompt text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  role text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  confidence text default 'medium',
  created_at timestamptz not null default now()
);

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Current term',
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.extracted_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_import_id text references public.draft_imports(id) on delete cascade,
  document_id text references public.documents(id) on delete set null,
  item_type text not null,
  payload jsonb not null default '{}'::jsonb,
  confidence text not null default 'medium',
  source_excerpt text default '',
  status text not null default 'needs_review',
  created_at timestamptz not null default now()
);

create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_import_id text references public.draft_imports(id) on delete cascade,
  title text not null,
  status text not null default 'needs_review',
  created_at timestamptz not null default now()
);

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  policy_type text not null,
  body text not null default '',
  source_document_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.citations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id text references public.documents(id) on delete set null,
  target_type text not null,
  target_id text not null,
  source_excerpt text not null default '',
  confidence text not null default 'medium',
  created_at timestamptz not null default now()
);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null default 'Course chat',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.documents enable row level security;
alter table public.draft_imports enable row level security;
alter table public.assignments enable row level security;
alter table public.exams enable row level security;
alter table public.readings enable row level security;
alter table public.tasks enable row level security;
alter table public.study_sessions enable row level security;
alter table public.weekly_resets enable row level security;
alter table public.decoder_runs enable row level security;
alter table public.chat_messages enable row level security;
alter table public.terms enable row level security;
alter table public.extracted_items enable row level security;
alter table public.review_queue enable row level security;
alter table public.policies enable row level security;
alter table public.citations enable row level security;
alter table public.chat_threads enable row level security;

create policy "profiles own rows" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "courses own rows" on public.courses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents own rows" on public.documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "draft imports own rows" on public.draft_imports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "assignments own rows" on public.assignments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exams own rows" on public.exams for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "readings own rows" on public.readings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks own rows" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study sessions own rows" on public.study_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weekly resets own rows" on public.weekly_resets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "decoder runs own rows" on public.decoder_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chat messages own rows" on public.chat_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "terms own rows" on public.terms for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "extracted items own rows" on public.extracted_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "review queue own rows" on public.review_queue for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "policies own rows" on public.policies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "citations own rows" on public.citations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chat threads own rows" on public.chat_threads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', false)
on conflict (id) do nothing;
