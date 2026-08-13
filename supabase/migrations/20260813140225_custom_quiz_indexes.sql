create index quiz_attempts_quiz_id_idx on public.quiz_attempts (quiz_id, submitted_at);
create index quiz_attempts_session_id_idx on public.quiz_attempts (session_id, submitted_at);
create index quiz_item_answers_item_id_idx on public.quiz_item_answers (item_id);
