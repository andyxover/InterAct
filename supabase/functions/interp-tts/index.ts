import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

// One sentence of the interpreter's translation, spoken in a fixed voice.
//
// gpt-realtime-translate speaks in a voice that follows the presenter's own
// tone phrase by phrase, and offers no way to choose a voice or a manner. For
// a class that is better served by one steady voice, the presenter app takes
// the model's translated TEXT (which arrives just as fast) and has each
// sentence read here by a text-to-speech voice of the presenter's choosing,
// with a tone they wrote. Audio streams back as 24 kHz 16-bit PCM the moment
// the first bytes exist, so the sentence starts playing while the rest is
// still being made; the app plays it through the same output as the live
// interpreter (SKAA, phones, both).

const MAX_TEXT = 600
const MAX_TONE = 400
const VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'marin', 'cedar', 'nova', 'onyx', 'sage', 'shimmer', 'verse'])
const VOICES_TTS1 = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'])

function ttsModel() {
  return Deno.env.get('OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts'
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
    const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT) : ''
    const lang = input.lang === 'zh' ? 'zh' : 'en'
    const voice = typeof input.voice === 'string' && VOICES.has(input.voice) ? input.voice : 'marin'
    const tone = typeof input.tone === 'string' ? input.tone.replace(/[<>]/g, ' ').trim().slice(0, MAX_TONE) : ''
    // 'fast' is the older tts-1: quicker to the first word, no say in the
    // manner. The default reads in the manner the presenter wrote.
    const fast = input.model === 'fast'
    if (!sessionId || !presenterToken || !text) return jsonResponse({ message: '缺少口譯所需資料。' }, 400)

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

    // The tone is the presenter's; the language line keeps a Chinese voice
    // from drifting into Mainland pronunciation, and an English one from
    // reading Chinese names oddly.
    const language = lang === 'zh' ? 'Speak Taiwanese Mandarin (Traditional Chinese pronunciation).' : 'Speak clear, natural English.'
    const instructions = `${tone || 'A calm, steady classroom interpreter: even pace, clear, unhurried, the same manner for every sentence.'} ${language} Read the text exactly as given; do not add or answer anything.`.slice(0, 600)

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fast
        ? { model: 'tts-1', voice: VOICES_TTS1.has(voice) ? voice : 'alloy', input: text, response_format: 'pcm' }
        : { model: ttsModel(), voice, input: text, instructions, response_format: 'pcm' }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      console.error('interp-tts openai failed', response.status, (await response.text().catch(() => '')).slice(0, 300))
      return jsonResponse({ message: '口譯語音產生失敗。' }, 502)
    }
    // Passed through as it arrives, not collected first.
    return new Response(response.body, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'audio/pcm', 'X-Sample-Rate': '24000', 'Access-Control-Expose-Headers': 'X-Sample-Rate', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('interp-tts failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '口譯語音產生失敗。' }, 500)
  }
})
