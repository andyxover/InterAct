-- Presenter mutations now go through presenter-action, which verifies the
-- per-session presenter token before using the service role.
drop policy if exists "update active sessions only" on public.sessions;
drop policy if exists "mvp update sessions" on public.sessions;
drop policy if exists "update participants in active sessions" on public.participants;
drop policy if exists "mvp update participants" on public.participants;
drop policy if exists "add screenshots to active sessions" on public.screenshots;
drop policy if exists "mvp insert screenshots" on public.screenshots;
drop policy if exists "update screenshots in active sessions" on public.screenshots;
drop policy if exists "mvp update screenshots" on public.screenshots;
drop policy if exists "add questions to active sessions" on public.questions;
drop policy if exists "mvp insert questions" on public.questions;
drop policy if exists "update questions in active sessions" on public.questions;
drop policy if exists "mvp update questions" on public.questions;
drop policy if exists "grade answers before class ends" on public.answers;
drop policy if exists "mvp update answers" on public.answers;
drop policy if exists "upload screenshots to active sessions" on storage.objects;
drop policy if exists "mvp insert screenshot objects" on storage.objects;
drop policy if exists "replace screenshots in active sessions" on storage.objects;
drop policy if exists "mvp update screenshot objects" on storage.objects;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.sessions, public.screenshots, public.questions, public.ai_summaries,
  public.shared_contents, public.session_events to anon, authenticated;
grant select, insert on public.participants, public.messages, public.answers, public.exit_tickets
  to anon, authenticated;

-- Foreign-key indexes keep session loading and cascade cleanup predictable as
-- classroom data grows.
create index if not exists ai_summaries_question_id_idx on public.ai_summaries (question_id);
create index if not exists ai_summaries_session_id_idx on public.ai_summaries (session_id);
create index if not exists answers_participant_id_idx on public.answers (participant_id);
create index if not exists answers_session_id_idx on public.answers (session_id);
create index if not exists exit_tickets_participant_id_idx on public.exit_tickets (participant_id);
create index if not exists messages_participant_id_idx on public.messages (participant_id);
create index if not exists messages_session_id_idx on public.messages (session_id);
create index if not exists questions_screenshot_id_idx on public.questions (screenshot_id);
create index if not exists questions_session_id_idx on public.questions (session_id);
create index if not exists screenshots_session_id_idx on public.screenshots (session_id);
create index if not exists sessions_current_question_id_idx on public.sessions (current_question_id);
