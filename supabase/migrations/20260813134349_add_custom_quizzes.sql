alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions
  add constraint questions_type_check
  check (type in (
    'send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer',
    'pronunciation', 'oral_response', 'custom_quiz'
  ));

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null unique references public.questions(id) on delete cascade,
  title text not null,
  direction text not null,
  requested_count integer null check (requested_count between 1 and 10),
  requested_type text not null check (requested_type in ('random', 'multiple_choice', 'fill_blank', 'short_answer')),
  total_points integer not null default 100 check (total_points = 100),
  created_at timestamptz not null default now()
);

create table public.quiz_items (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null check (position between 1 and 10),
  type text not null check (type in ('multiple_choice', 'fill_blank', 'short_answer')),
  prompt_text text not null check (char_length(prompt_text) between 1 and 2000),
  options jsonb not null default '[]'::jsonb,
  points integer not null check (points between 1 and 100),
  translations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (quiz_id, position)
);

create table public.quiz_item_keys (
  item_id uuid primary key references public.quiz_items(id) on delete cascade,
  accepted_answers text[] not null default '{}'::text[],
  rubric text not null default '',
  created_at timestamptz not null default now()
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  status text not null default 'grading' check (status in ('grading', 'graded', 'failed')),
  total_score numeric(6,2) null check (total_score between 0 and 100),
  max_score integer not null default 100 check (max_score = 100),
  feedback jsonb null,
  error_message text null,
  submitted_at timestamptz not null default now(),
  graded_at timestamptz null,
  unique (question_id, participant_id)
);

create table public.quiz_item_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  item_id uuid not null references public.quiz_items(id) on delete cascade,
  answer_text text null check (coalesce(char_length(answer_text), 0) <= 4000),
  answer_values text[] null,
  score numeric(6,2) null check (score >= 0),
  feedback jsonb null,
  created_at timestamptz not null default now(),
  unique (attempt_id, item_id)
);

create index quizzes_session_id_idx on public.quizzes (session_id);
create index quiz_items_quiz_id_idx on public.quiz_items (quiz_id, position);
create index quiz_attempts_question_id_idx on public.quiz_attempts (question_id, submitted_at);
create index quiz_attempts_participant_id_idx on public.quiz_attempts (participant_id, submitted_at);
create index quiz_item_answers_attempt_id_idx on public.quiz_item_answers (attempt_id);

alter table public.quizzes enable row level security;
alter table public.quiz_items enable row level security;
alter table public.quiz_item_keys enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_item_answers enable row level security;

create policy "read dispatched quizzes" on public.quizzes for select
to anon, authenticated
using (
  exists (
    select 1 from public.questions
    where questions.id = quizzes.question_id
      and questions.session_id = quizzes.session_id
  )
);

create policy "read dispatched quiz items" on public.quiz_items for select
to anon, authenticated
using (
  exists (
    select 1 from public.quizzes
    join public.questions on questions.id = quizzes.question_id
    where quizzes.id = quiz_items.quiz_id
  )
);

revoke all on public.quizzes, public.quiz_items, public.quiz_item_keys, public.quiz_attempts, public.quiz_item_answers from public, anon, authenticated;
grant select on public.quizzes, public.quiz_items to anon, authenticated;
grant all on public.quizzes, public.quiz_items, public.quiz_item_keys, public.quiz_attempts, public.quiz_item_answers to service_role;

drop policy if exists "answer active questions" on public.answers;
create policy "answer active questions" on public.answers for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = answers.session_id and sessions.status = 'active'
  )
  and exists (
    select 1 from public.questions
    where questions.id = answers.question_id
      and questions.session_id = answers.session_id
      and questions.status = 'active'
      and questions.type <> 'custom_quiz'
  )
  and exists (
    select 1 from public.participants
    where participants.id = answers.participant_id
      and participants.session_id = answers.session_id
      and participants.name = answers.participant_name
  )
  and is_correct is null
  and coalesce(char_length(answer_value), 0) <= 500
  and coalesce(char_length(answer_text), 0) <= 1000
  and coalesce(array_length(answer_values, 1), 0) <= 20
  and not exists (
    select 1 from unnest(coalesce(answer_values, '{}'::text[])) as submitted_value
    where char_length(submitted_value) > 500
  )
);
