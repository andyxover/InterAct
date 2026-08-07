import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const supportedLanguages = new Set(['zh-tw', 'zh-cn', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'th', 'vi', 'id'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    const mode = input.mode === 'translation' ? 'translation' : 'transcription'
    const targetLanguage = typeof input.targetLanguage === 'string' ? input.targetLanguage : ''
    if (!sessionId || !presenterToken) return jsonResponse({ message: '缺少講師字幕權限資料。' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const [{ data: keyRecord }, { data: session }] = await Promise.all([
      supabase.from('presenter_session_keys').select('session_id').eq('session_id', sessionId).eq('token_hash', tokenHash).maybeSingle(),
      supabase.from('sessions').select('status, caption_source_language, interpretation_enabled, interpretation_languages').eq('id', sessionId).maybeSingle(),
    ])
    if (!keyRecord) return jsonResponse({ message: '講師權限驗證失敗。' }, 403)
    if (!session || session.status !== 'active') return jsonResponse({ message: '場次已結束，無法開啟字幕。' }, 409)

    const sourceLanguage = supportedLanguages.has(session.caption_source_language) ? session.caption_source_language : 'zh-tw'
    if (mode === 'translation' && (
      !session.interpretation_enabled ||
      !supportedLanguages.has(targetLanguage) ||
      !session.interpretation_languages?.includes(targetLanguage)
    )) return jsonResponse({ message: '這個口譯語言未在場次中啟用。' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return jsonResponse({ message: '尚未在 Supabase 設定 OPENAI_API_KEY。' }, 503)

    const endpoint = mode === 'translation'
      ? 'https://api.openai.com/v1/realtime/translations/client_secrets'
      : 'https://api.openai.com/v1/realtime/client_secrets'
    const body = mode === 'translation'
      ? {
          session: {
            model: 'gpt-realtime-translate',
            audio: {
              output: { language: targetLanguage },
            },
          },
        }
      : {
          session: {
            type: 'transcription',
            audio: {
              input: {
                transcription: { model: 'gpt-live-transcribe', languages: [sourceLanguage], delay: 'low' },
                turn_detection: null,
              },
            },
          },
        }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': `interact_${tokenHash.slice(0, 48)}`,
      },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('OpenAI realtime client secret failed', response.status, result?.error?.message || result)
      return jsonResponse({ message: '無法建立即時字幕連線。', detail: result?.error?.message }, response.status)
    }

    const clientSecret = result?.value || result?.client_secret?.value || result?.client_secret
    if (typeof clientSecret !== 'string') throw new Error('OpenAI did not return a client secret.')
    return jsonResponse({ clientSecret, mode, sourceLanguage, targetLanguage: mode === 'translation' ? targetLanguage : sourceLanguage })
  } catch (error) {
    console.error('openai-realtime-session failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '建立即時字幕連線失敗。' }, 500)
  }
})
