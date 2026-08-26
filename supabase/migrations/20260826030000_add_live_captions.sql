create table if not exists public.captions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  original text not null,
  original_lang text null,
  text_zh text null,
  text_en text null,
  created_at timestamptz not null default now()
);

create index if not exists captions_session_created_at_idx
  on public.captions (session_id, created_at desc);

alter table public.captions enable row level security;

create policy "mvp read captions" on public.captions for select using (true);

alter publication supabase_realtime add table public.captions;
