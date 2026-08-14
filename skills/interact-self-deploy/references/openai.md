# OpenAI Realtime Deployment (Plus edition only)

Only required when packaging `InterActPlus.exe` (live captions and interpretation). Skip this step entirely for the `InterAct.exe` (standard) edition.

Create a project API key at [OpenAI Platform](https://platform.openai.com/api-keys) under the instructor's own OpenAI account. The key must exist only in Supabase Edge Function secrets; it is never sent to the frontend or the desktop app.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-openai.ps1 -ProjectRef YOUR_PROJECT_REF
```

The script securely prompts for the API key, sets `OPENAI_API_KEY`, deletes its temporary secret file, and redeploys the `openai-realtime-session` function. The frontend only ever receives a short-lived Realtime client secret minted by that function; the long-lived key stays in Supabase.

## Checkpoint

Open the packaged `InterActPlus.exe`, start a session, choose a speaker language, and press "開始即時字幕" (start live captions). Confirm captions appear on the presenter overlay and, for at least one interpretation language, that a participant device can select and hear the translated audio.
