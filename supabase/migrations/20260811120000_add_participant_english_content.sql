alter table public.questions
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.sessions
  add column if not exists exit_ticket_prompt_en text;

comment on column public.questions.translations is 'Localized question title, prompt, and options keyed by locale.';
comment on column public.sessions.exit_ticket_prompt_en is 'English translation of the generated Exit Ticket prompt.';
