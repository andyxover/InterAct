# InterAct Plus 即時字幕設定

InterAct Plus 使用 OpenAI Realtime API 產生原文字幕與多語翻譯字幕，課後分析仍使用既有的 Gemini API。

## 必要設定

1. 到 OpenAI Platform 建立專案 API key。
2. 到 Supabase Dashboard 的 Edge Functions Secrets 新增：

   - Name：`OPENAI_API_KEY`
   - Value：OpenAI 專案 API key

3. 不要把 OpenAI API key 寫入 `.env`、前端程式、GitHub Secrets 以外的公開檔案，或打包進 `InterAct.exe`。

## 運作方式

- 講師開課時選擇講話語言、講師字幕語言，以及開放給學生的翻譯字幕語言。
- 講師在功能列按「開始即時字幕」後，Windows App 才會要求麥克風權限。
- 前端只取得短效 Realtime client secret；長效 OpenAI key 只存在 Supabase。
- 未完成字幕以 Supabase Realtime Broadcast 傳送，完整句子寫入 `caption_segments`。
- 學員可從講師開放的語言中切換字幕。
- 原文逐字稿會進入下課 AI 分析，Excel 會新增「即時字幕逐字稿」工作表。

## 尚未包含

多人「翻譯語音」廣播需要 LiveKit、Cloudflare Calls 或其他 SFU／媒體服務。現階段已完成即時原文與翻譯字幕，未把每位學生直接連到 OpenAI，避免費用隨學生人數成倍增加。
