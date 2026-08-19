# Windows Portable App

Windows 執行檔會在建置時包含公開的 Supabase URL、publishable key 與 GitHub Pages URL，不包含 Gemini 或 Reurl secret。每位講師都必須針對自己的部署重新打包。

執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 `
  -SupabaseUrl https://PROJECT_REF.supabase.co `
  -PublishableKey sb_publishable_xxx `
  -PublicAppUrl https://OWNER.github.io/REPOSITORY
```

腳本會建立本機且被 Git 忽略的 `.env`、安裝鎖定版本的相依套件、建置前端、打包 Windows x64 portable app，最後把 `InterAct.exe` 複製到專案根目錄。

## Checkpoint

開啟 `InterAct.exe` 建立場次，使用不同網路的手機掃描 QR Code。確認網址指向自己的 GitHub Pages，且新場次只出現在自己的 Supabase 專案。
