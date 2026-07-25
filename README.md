# InterAct 即時互動教學系統

InterAct stands for Intelligent Teaching, Engagement, Response and Classroom Technology.

InterAct is a real-time classroom interaction web app for teachers, speakers, trainers, and workshop facilitators. It allows presenters to create a live session, show a QR Code, receive audience questions as danmaku, send screenshots, launch polls and questions, collect answers, summarize short responses with AI, and generate an Exit Ticket summary.

This version is a GitHub Pages deployable web app using:

- React
- TypeScript
- Vite
- Supabase Database
- Supabase Realtime
- Supabase Storage
- Supabase Edge Functions

## Current Features

- Presenter creates a session.
- Presenter sees a QR Code and join URL.
- Participant joins with a required name.
- Participant sends messages.
- Presenter sees right-to-left danmaku.
- Presenter can turn danmaku on or off.
- Presenter can turn anonymous mode on or off.
- Presenter can capture a selected region from the display that contains the QR window.
- Presenter can send screenshots, text, and links to participants.
- Presenter can create polls, multiple-choice, true-false, and short-answer questions.
- Participant can answer once.
- Presenter can stop answering and select the correct answer.
- Presenter sees answer counts and correct/incorrect percentages.
- Presenter can run a lottery, buzzer, word cloud, Exit Ticket, and AI session report.
- Presenter can export the complete class report to Excel.

## Local Setup

1. Install dependencies.

```bash
pnpm install
```

2. Create `.env` from `.env.example`.

```bash
cp .env.example .env
```

3. Create a new Supabase project and use the deployment script documented below. The schema script creates the database, RLS policies, Realtime publication, and Storage bucket together.

4. Start the dev server.

```bash
pnpm dev
```

## Windows Presenter App

The participant app remains available on GitHub Pages. The presenter can also run a Windows desktop app for screen capture.

```bash
pnpm desktop:dev
```

The desktop app opens the presenter flow and adds screen-region capture to the presenter control panel. Package the portable Windows x64 app with the checked beginner script:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 -SupabaseUrl https://YOUR_PROJECT_REF.supabase.co -PublishableKey sb_publishable_YOUR_VALUE -PublicAppUrl https://YOUR_GITHUB_USER.github.io/InterAct
```

## Build

```bash
pnpm build
```

The app uses `HashRouter`, so GitHub Pages refreshes do not 404.

## Self-hosted Deployment

Each InterAct installation uses four independent accounts and does not share the original developer's quota or classroom data:

1. Supabase hosts the database, Realtime, Storage, and Edge Functions.
2. Google AI Studio supplies the Gemini API key stored only as a Supabase secret.
3. GitHub Pages hosts the participant website using repository variables.
4. Reurl.cc supplies the optional short URL key stored only as a Supabase secret.

Install the reusable deployment skill, restart Codex, then invoke `$interact-self-deploy`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-deployment-skill.ps1
```

The tracked skill source is at [`skills/interact-self-deploy/SKILL.md`](skills/interact-self-deploy/SKILL.md). It includes separate scripts and verification checkpoints for every service. Never put a Gemini key, Reurl key, Supabase secret key, or service-role key in `.env`, GitHub Pages variables, frontend code, screenshots, or support messages.

A Traditional Chinese beginner tutorial is available at [`docs/InterAct-從零部署與打包教學.md`](docs/InterAct-從零部署與打包教學.md).

The participant interface always displays links to the InterAct creator's [Facebook](https://www.facebook.com/lienyujen) and [YouTube](https://www.youtube.com/@lienlaoshi) pages.
