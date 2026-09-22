import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashParticipantToken } from '../_shared/supabase.ts'
import { ensureSpokenCaption } from '../_shared/tts.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validUuid(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return jsonResponse({ message: '口譯服務尚未設定。' }, 503)

    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const participantId = typeof input.participantId === 'string' ? input.participantId : ''
    const participantToken = typeof input.participantToken === 'string' ? input.participantToken : ''
    const captionId = typeof input.captionId === 'string' ? input.captionId : ''
    const lang = input.lang === 'en' ? 'en' : 'zh'
    if (!validUuid(sessionId) || !validUuid(participantId) || !validUuid(captionId) || participantToken.length < 32) {
      return jsonResponse({ message: '缺少口譯所需資料。' }, 400)
    }

    const supabase = getAdminClient()
    const tokenHash = await hashParticipantToken(participantToken)
    const { data: keyRecord } = await supabase
      .from('participant_session_keys')
      .select('participant_id, participants!inner(id, session_id)')
      .eq('participant_id', participantId)
      .eq('token_hash', tokenHash)
      .eq('participants.session_id', sessionId)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '學員權限驗證失敗。' }, 403)

    const { data: caption } = await supabase
      .from('captions')
      .select('id, session_id, original, original_lang, text_zh, text_en')
      .eq('id', captionId)
      .eq('session_id', sessionId)
      .single()
    if (!caption) return jsonResponse({ message: '找不到這句字幕。' }, 404)

    // Usually already there: live-caption warms the audio when the caption is
    // stored, so this is a lookup, not a wait.
    const spoken = await ensureSpokenCaption(supabase, apiKey, caption, lang)
    if (!spoken) return jsonResponse({ message: '這句字幕沒有可口譯的內容。' }, 422)
    return jsonResponse(spoken)
  } catch (error) {
    console.error('caption-tts failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '口譯語音產生失敗。' }, 500)
  }
})
