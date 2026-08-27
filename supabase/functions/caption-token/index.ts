import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

function transcribeModel() {
  return Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe'
}

function turnDetection() {
  // Semantic VAD segments on sentence meaning instead of pure silence, which
  // produces better-shaped captions from continuous speakers. Overridable in
  // case the account or model rejects it.
  const type = Deno.env.get('OPENAI_TURN_DETECTION') || 'semantic_vad'
  const eagerness = Deno.env.get('OPENAI_VAD_EAGERNESS') || 'high'
  return type === 'server_vad'
    ? { type: 'server_vad', silence_duration_ms: 600 }
    : { type: 'semantic_vad', eagerness }
}

// Mints a short-lived OpenAI Realtime transcription token so the presenter
// app can stream microphone audio directly to OpenAI without ever holding the
// real API key. Tries the GA client_secrets endpoint first, then the beta
// transcription_sessions endpoint.
async function mintEphemeralToken(apiKey: string, vocabulary: string) {
  const transcription: Record<string, string> = { model: transcribeModel() }
  if (vocabulary) transcription.prompt = vocabulary

  const gaResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription,
            turn_detection: turnDetection(),
          },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (gaResponse.ok) {
    const data = await gaResponse.json()
    const token = typeof data?.value === 'string' ? data.value : data?.client_secret?.value
    if (typeof token === 'string' && token) {
      return { token, mode: 'ga', expiresAt: data?.expires_at ?? null }
    }
  }
  const gaFailure = `GA client_secrets failed (${gaResponse.status}): ${(await gaResponse.text().catch(() => '')).slice(0, 300)}`

  const betaResponse = await fetch('https://api.openai.com/v1/realtime/transcription_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1',
    },
    body: JSON.stringify({
      input_audio_format: 'pcm16',
      input_audio_transcription: transcription,
      turn_detection: { type: 'server_vad', silence_duration_ms: 600 },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (betaResponse.ok) {
    const data = await betaResponse.json()
    const token = data?.client_secret?.value
    if (typeof token === 'string' && token) {
      return { token, mode: 'beta', expiresAt: data?.client_secret?.expires_at ?? null }
    }
  }
  throw new Error(`${gaFailure}; beta transcription_sessions failed (${betaResponse.status}): ${(await betaResponse.text().catch(() => '')).slice(0, 300)}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return jsonResponse({ message: '字幕服務尚未設定，請先設定 OPENAI_API_KEY。' }, 503)

    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    if (!sessionId || !presenterToken) return jsonResponse({ message: '缺少字幕所需資料。' }, 400)

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
    if (!session || session.status !== 'active') return jsonResponse({ message: '場次已結束，無法產生字幕。' }, 409)

    // Course-specific terms the teacher supplied; passed to the transcription
    // model as a bias prompt. Untrusted text, so cap the length hard.
    const vocabulary = typeof input.vocabulary === 'string' ? input.vocabulary.trim().slice(0, 600) : ''
    const ephemeral = await mintEphemeralToken(apiKey, vocabulary)
    return jsonResponse(ephemeral)
  } catch (error) {
    console.error('caption-token failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '無法建立字幕連線，請稍後再試。' }, 500)
  }
})
