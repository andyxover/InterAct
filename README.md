# InterAct 即時互動教學系統

InterAct stands for Intelligent Teaching, Engagement, Response and Classroom Technology.

InterAct is a real-time classroom interaction system for teachers, speakers, trainers, and workshop facilitators. Presenters create a live session, show a QR Code, receive audience questions as danmaku, send screenshots, launch polls and quizzes, collect answers, summarize responses with AI, and generate an Exit Ticket summary. Participants join from any browser — no app install required.

## Two editions, one codebase

InterAct ships as two Windows presenter apps built from the same source. Everyone deploying InterAct picks which one (or both) to package:

| | `InterAct.exe` (standard) | `InterActPlus.exe` (plus) |
| --- | --- | --- |
| Danmaku, polls/quizzes, screenshot interaction, lottery, buzzer, AI session report | ✅ | ✅ |
| Live captions | — | ✅ |
| Real-time interpretation audio | — | ✅ |
| Extra service required | none | OpenAI (GPT Realtime) |

The standard edition's presenter control panel doesn't just hide a settings toggle — the captions/interpretation buttons and settings screen are absent entirely, so it stays a simpler interface for anyone who doesn't need live captions.

The participant-facing web app is the same for both editions; whether a session offers captions/interpretation depends only on which exe the presenter is running.

## Stack

- React, TypeScript, Vite — participant web app, deployed to GitHub Pages
- Electron — presenter desktop app (screen capture, always-on-top control panel)
- Supabase — Database, Realtime, Storage, Edge Functions
- Google Gemini — screenshot/question grading and end-of-class AI analysis
- OpenAI Realtime (Plus edition only) — live captions and interpretation audio
- Reurl.cc (optional) — shortens the participant join URL

## Current Features

- Presenter creates a session, sees a QR Code and join URL.
- Participant joins with a required name and sends messages as danmaku.
- Presenter can turn danmaku or anonymous mode on or off.
- Presenter captures a screen region and sends screenshots, text, and links to participants.
- Presenter creates polls, multiple-choice, true/false, short-answer, and AI-graded custom quiz questions.
- Presenter runs a lottery, buzzer, word cloud, Exit Ticket, and AI session report; exports the full class report to Excel.
- **Plus edition only:** presenter starts live captions (with font/position controls) and real-time interpretation audio in multiple languages, selectable per participant.

## Local Setup

1. Install dependencies.

```bash
pnpm install
```

2. Create `.env` from `.env.example` and fill in your own Supabase project values (see [Self-hosted Deployment](#self-hosted-deployment) below — every installation needs its own Supabase project, not the original developer's).

```bash
cp .env.example .env
```

3. Start the dev server.

```bash
pnpm dev
```

## Windows Presenter App

The participant app stays on GitHub Pages. The presenter runs a Windows desktop app for screen capture, always-on-top controls, and (Plus edition) live captions.

```bash
pnpm desktop:dev            # Plus edition, dev mode
pnpm desktop:dev:standard   # standard edition, dev mode
```

Package the portable Windows x64 app. Pick the script matching the edition you want:

```bash
pnpm desktop:package            # builds InterActPlus.exe
pnpm desktop:package:standard   # builds InterAct.exe
```

Both write to `release/`; the [beginner packaging script](skills/interact-self-deploy/scripts/package-windows.ps1) additionally copies the result to the repository root and accepts `-Edition standard` / `-Edition plus`:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 -SupabaseUrl https://YOUR_PROJECT_REF.supabase.co -PublishableKey sb_publishable_YOUR_VALUE -PublicAppUrl https://YOUR_GITHUB_USER.github.io/InterAct -Edition plus
```

## Build

```bash
pnpm build            # web app + InterActPlus.exe source, Plus edition feature set
pnpm build:standard   # web app source, standard edition feature set (no captions/interpretation)
```

The app uses `HashRouter`, so GitHub Pages refreshes do not 404.

## Self-hosted Deployment

Each InterAct installation uses independent accounts and does not share the original developer's quota or classroom data:

1. **Supabase** hosts the database, Realtime, Storage, and Edge Functions. (required)
2. **Google AI Studio** supplies the Gemini API key, stored only as a Supabase secret. (required)
3. **GitHub Pages** hosts the participant website using repository variables. (required)
4. **Reurl.cc** supplies the optional short URL key, stored only as a Supabase secret. (optional)
5. **OpenAI Platform** supplies the GPT Realtime API key for live captions/interpretation, stored only as a Supabase secret. (only needed for `InterActPlus.exe`)

A full Traditional Chinese beginner tutorial — covering every account, every key, and packaging both exe editions — is at [`docs/InterAct-從零部署與打包教學.md`](docs/InterAct-從零部署與打包教學.md).

If you use Claude Code or Codex, install the reusable deployment skill, restart it, then invoke `$interact-self-deploy` to be walked through each phase interactively:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-deployment-skill.ps1
```

The tracked skill source is at [`skills/interact-self-deploy/SKILL.md`](skills/interact-self-deploy/SKILL.md). It includes separate scripts and verification checkpoints for every service, including the OpenAI step for the Plus edition. Never put a Gemini key, Reurl key, OpenAI key, Supabase secret key, or service-role key in `.env`, GitHub Pages variables, frontend code, screenshots, or support messages.

The participant interface always displays links to the InterAct creator's [Facebook](https://www.facebook.com/lienyujen) and [YouTube](https://www.youtube.com/@lienlaoshi) pages.
