# Windows Portable App

The desktop executable contains the public Supabase URL, publishable key, and GitHub Pages URL at build time. It contains no Gemini, Reurl, or OpenAI secret. Rebuild the executable for every instructor's deployment.

There are two editions. Pick one with `-Edition`:

- `plus` (default) — builds `InterActPlus.exe`: screenshot interaction plus live captions and interpretation. Requires the [OpenAI Realtime deployment](openai.md) step.
- `standard` — builds `InterAct.exe`: screenshot interaction only, no captions/interpretation UI at all. Skip the OpenAI step entirely.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 `
  -SupabaseUrl https://PROJECT_REF.supabase.co `
  -PublishableKey sb_publishable_xxx `
  -PublicAppUrl https://OWNER.github.io/REPOSITORY `
  -Edition plus
```

The script writes the local ignored `.env`, installs locked dependencies, builds the frontend for the chosen edition, packages a portable x64 Windows app in the local temp directory, and copies `InterActPlus.exe` or `InterAct.exe` to the repository root. Run it twice (once per `-Edition`) to produce both executables.

## Checkpoint

Open the resulting exe, create a session, and scan its QR code with a device not connected to the presenter's network. Confirm the URL points to the new GitHub Pages site and the session data appears only in the new Supabase project. For the `plus` edition, also confirm the settings gear and live-caption buttons appear in the control panel; for `standard`, confirm they do not.
