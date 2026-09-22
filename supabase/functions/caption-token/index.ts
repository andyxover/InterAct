import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

// gpt-live-transcribe: built for low-latency transcript deltas from live
// audio, with keyword and language hints. It does its own thing about turns —
// the client commits each one — so the app segments speech itself (see
// liveCaptions.ts). Set OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe to go
// back to the older model with server-side turn detection.
function transcribeModel() {
  return Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-live-transcribe'
}

function isLiveModel(model: string) {
  return model.startsWith('gpt-live-transcribe')
}

function transcribeLanguages() {
  // A Mandarin classroom with English terms, by default. Comma-separated
  // BCP-47 codes in OPENAI_TRANSCRIBE_LANGUAGES to change it.
  const raw = Deno.env.get('OPENAI_TRANSCRIBE_LANGUAGES') || 'zh,en'
  return raw.split(',').map((code) => code.trim()).filter(Boolean).slice(0, 8)
}

function transcribeDelay() {
  const delay = Deno.env.get('OPENAI_TRANSCRIBE_DELAY') || 'low'
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(delay) ? delay : 'low'
}

function turnDetection() {
  // Server VAD, tuned short, for the older models. Semantic VAD waits for
  // the sentence to feel finished, which for a lecturer who never quite
  // pauses meant one caption per paragraph, a minute late.
  const type = Deno.env.get('OPENAI_TURN_DETECTION') || 'server_vad'
  if (type === 'semantic_vad') {
    return { type: 'semantic_vad', eagerness: Deno.env.get('OPENAI_VAD_EAGERNESS') || 'high' }
  }
  const silence = Number(Deno.env.get('OPENAI_VAD_SILENCE_MS') || 500)
  const threshold = Number(Deno.env.get('OPENAI_VAD_THRESHOLD') || 0.5)
  return {
    type: 'server_vad',
    threshold: Number.isFinite(threshold) ? threshold : 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: Number.isFinite(silence) ? silence : 500,
  }
}

/** The teacher's 課程關鍵詞 box, one term per line or comma, as keyword hints. */
function keywordsFrom(vocabulary: string) {
  return vocabulary
    .split(/[\n,，、;；]+/)
    .map((term) => term.replace(/[<>\r\n]/g, ' ').trim())
    .filter((term) => term.length > 0 && term.length <= 60)
    .slice(0, 50)
}

// Mints a short-lived OpenAI Realtime transcription token so the presenter
// app can stream microphone audio directly to OpenAI without ever holding the
// real API key. Tries the GA client_secrets endpoint first, then the beta
// transcription_sessions endpoint.
async function mintEphemeralToken(apiKey: string, vocabulary: string) {
  const model = transcribeModel()
  const live = isLiveModel(model)
  const keywords = keywordsFrom(vocabulary)

  const transcription: Record<string, unknown> = { model }
  if (live) {
    transcription.delay = transcribeDelay()
    transcription.languages = transcribeLanguages()
    if (keywords.length) transcription.keywords = keywords
    if (vocabulary) transcription.prompt = `Classroom lecture. Course terms: ${keywords.join(', ')}`.slice(0, 600)
  } else if (vocabulary) {
    transcription.prompt = vocabulary
  }

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
            // The live model takes turns from the client; the older ones from
            // the server's VAD.
            turn_detection: live ? null : turnDetection(),
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
      return { token, mode: 'ga', model, clientCommits: live, expiresAt: data?.expires_at ?? null }
    }
  }
  const gaFailure = `GA client_secrets failed (${gaResponse.status}): ${(await gaResponse.text().catch(() => '')).slice(0, 300)}`

  const betaTranscription: Record<string, unknown> = { model }
  if (live) {
    betaTranscription.delay = transcribeDelay()
    betaTranscription.languages = transcribeLanguages()
    if (keywords.length) betaTranscription.keywords = keywords
  } else if (vocabulary) {
    betaTranscription.prompt = vocabulary
  }
  const betaResponse = await fetch('https://api.openai.com/v1/realtime/transcription_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1',
    },
    body: JSON.stringify({
      input_audio_format: 'pcm16',
      input_audio_transcription: betaTranscription,
      turn_detection: live ? null : { type: 'server_vad', silence_duration_ms: 500 },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (betaResponse.ok) {
    const data = await betaResponse.json()
    const token = data?.client_secret?.value
    if (typeof token === 'string' && token) {
      return { token, mode: 'beta', model, clientCommits: live, expiresAt: data?.client_secret?.expires_at ?? null }
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

    // Course-specific terms the teacher supplied. Untrusted text, capped hard.
    const vocabulary = typeof input.vocabulary === 'string' ? input.vocabulary.trim().slice(0, 600) : ''
    const ephemeral = await mintEphemeralToken(apiKey, vocabulary)
    return jsonResponse(ephemeral)
  } catch (error) {
    console.error('caption-token failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '無法建立字幕連線，請稍後再試。' }, 500)
  }
})
