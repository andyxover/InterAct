import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const TRANSLATE_MODEL = 'gpt-realtime-translate'
const LANGUAGES = new Set(['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de'])

// Mints a short-lived client secret for OpenAI's streaming speech-to-speech
// translation, so the presenter app can send microphone audio straight to
// OpenAI and get translated audio back without ever holding the real key.
// One session translates into one language; the app opens one per language.
async function mintTranslationSecret(apiKey: string, language: string) {
  const response = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        model: TRANSLATE_MODEL,
        audio: { output: { language } },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`translations/client_secrets failed (${response.status}): ${text.slice(0, 400)}`)
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { /* handled below */ }
  const token = typeof data?.value === 'string'
    ? data.value
    : typeof (data?.client_secret as Record<string, unknown> | undefined)?.value === 'string'
      ? (data.client_secret as Record<string, unknown>).value as string
      : ''
  if (!token) throw new Error(`translations/client_secrets returned no token: ${text.slice(0, 400)}`)
  const expiresAt = (data?.expires_at as number | undefined)
    ?? ((data?.client_secret as Record<string, unknown> | undefined)?.expires_at as number | undefined)
    ?? null
  return { token, expiresAt, model: TRANSLATE_MODEL, language }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return jsonResponse({ message: '口譯服務尚未設定，請先設定 OPENAI_API_KEY。' }, 503)

    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    const language = typeof input.language === 'string' && LANGUAGES.has(input.language) ? input.language : ''
    if (!sessionId || !presenterToken || !language) return jsonResponse({ message: '缺少口譯所需資料。' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '講者權限驗證失敗。' }, 403)

    const { data: session } = await supabase.from('sessions').select('id, status').eq('id', sessionId).single()
    if (!session || session.status !== 'active') return jsonResponse({ message: '場次已結束，無法開啟口譯。' }, 409)

    return jsonResponse(await mintTranslationSecret(apiKey, language))
  } catch (error) {
    console.error('translate-token failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '無法建立口譯連線，請稍後再試。' }, 500)
  }
})
