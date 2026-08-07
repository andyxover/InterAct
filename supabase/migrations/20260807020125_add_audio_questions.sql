alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions
  add constraint questions_type_check
  check (type in (
    'send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer',
    'pronunciation', 'oral_response'
  ));

create table public.participant_session_keys (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table public.audio_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  duration_ms integer not null check (duration_ms between 250 and 60000),
  file_size integer not null check (file_size between 1 and 10485760),
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'success', 'failed')),
  detected_language text null,
  transcript text null,
  score integer null check (score between 0 and 100),
  analysis_json jsonb null,
  error_message text null,
  submitted_at timestamptz not null default now(),
  analyzed_at timestamptz null,
  unique (question_id, participant_id)
);

create index audio_responses_session_id_idx on public.audio_responses (session_id);
create index audio_responses_question_id_idx on public.audio_responses (question_id);
create index audio_responses_participant_id_idx on public.audio_responses (participant_id);

alter table public.participant_session_keys enable row level security;
alter table public.audio_responses enable row level security;

revoke all on public.participant_session_keys, public.audio_responses from public, anon, authenticated;
grant all on public.participant_session_keys, public.audio_responses to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interact-recordings',
  'interact-recordings',
  false,
  10485760,
  array['audio/wav']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
