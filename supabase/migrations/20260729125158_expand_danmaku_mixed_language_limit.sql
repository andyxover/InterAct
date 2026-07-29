drop policy if exists "send messages to active sessions" on public.messages;

create policy "send messages to active sessions"
  on public.messages for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = messages.session_id
        and sessions.status = 'active'
    )
    and exists (
      select 1
      from public.participants
      where participants.id = messages.participant_id
        and participants.session_id = messages.session_id
        and participants.name = messages.participant_name
    )
    and char_length(btrim(content)) between 1 and 180
  );
