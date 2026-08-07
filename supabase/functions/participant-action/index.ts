import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { analyzeAudioResponse, removeRecording } from '../_shared/audio-analysis.ts'
import { getAdminClient, hashParticipantToken } from '../_shared/supabase.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validUuid(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value)
}

async function verifyParticipant(
  supabase: ReturnType<typeof getAdminClient>,
  sessionId: string,
  participantId: string,
  participantToken: string,
) {
  if (!validUuid(sessionId) || !validUuid(participantId) || participantToken.length < 32) return null
  const tokenHash = await hashParticipantToken(participantToken)
  const { data } = await supabase
    .from('participant_session_keys')
    .select('participant_id, participants!inner(id, session_id, name)')
    .eq('participant_id', participantId)
    .eq('token_hash', tokenHash)
    .eq('participants.session_id', sessionId)
    .maybeSingle()
  const participant = data?.participants as unknown as { id: string; session_id: string; name: string } | null
  return participant || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  let action = ''
  try {
    const input = await req.json()
    action = typeof input.action === 'string' ? input.action : ''
    const supabase = getAdminClient()

    if (action === 'join_session') {
      const reference = typeof input.sessionReference === 'string' ? input.sessionReference.trim() : ''
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : ''
      const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim().slice(0, 200) : ''
      if (!reference || !name || !deviceId) return jsonResponse({ message: '姓名或場次資料不完整。' }, 400)

      const isId = validUuid(reference)
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq(isId ? 'id' : 'code', reference)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!session) return jsonResponse({ message: '找不到這個場次。' }, 404)
      if (session.status !== 'active') return jsonResponse({ message: '這堂課已經結束，無法再加入。' }, 409)

      const { data: existing, error: existingError } = await supabase
        .from('participants')
        .select('*')
        .eq('session_id', session.id)
        .eq('device_id', deviceId)
        .maybeSingle()
      if (existingError) throw existingError

      let participant = existing
      if (!participant) {
        const { data, error } = await supabase
          .from('participants')
          .insert({ session_id: session.id, name, device_id: deviceId })
          .select('*')
          .single()
        if (error) throw error
        participant = data
      }

      const participantToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
      const tokenHash = await hashParticipantToken(participantToken)
      const { error: keyError } = await supabase
        .from('participant_session_keys')
        .upsert({ participant_id: participant.id, token_hash: tokenHash })
      if (keyError) throw keyError
      return jsonResponse({ session, participant, participantToken })
    }

    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const participantId = typeof input.participantId === 'string' ? input.participantId : ''
    const participantToken = typeof input.participantToken === 'string' ? input.participantToken : ''

    if (['prepare_recording_upload', 'submit_recording', 'get_recording_result'].includes(action)) {
      const participant = await verifyParticipant(supabase, sessionId, participantId, participantToken)
      if (!participant) return jsonResponse({ message: '學員權限驗證失敗，請重新掃描 QR Code 加入。' }, 403)
      const questionId = typeof input.questionId === 'string' ? input.questionId : ''
      if (!validUuid(questionId)) return jsonResponse({ message: '錄音題目資料不正確。' }, 400)

      const { data: question, error: questionError } = await supabase
        .from('questions')
        .select('id, session_id, screenshot_id, type, status, prompt_text')
        .eq('id', questionId)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (questionError) throw questionError
      if (!question || !['pronunciation', 'oral_response'].includes(question.type)) {
        return jsonResponse({ message: '找不到錄音題目。' }, 404)
      }

      if (action === 'get_recording_result') {
        const { data: response, error } = await supabase
          .from('audio_responses')
          .select('id, session_id, question_id, participant_id, participant_name, mime_type, duration_ms, analysis_status, detected_language, transcript, score, analysis_json, error_message, submitted_at, analyzed_at, storage_path')
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
          .maybeSingle()
        if (error) throw error
        if (!response) return jsonResponse({ response: null })
        if (question.status === 'active') {
          return jsonResponse({ response: {
            id: response.id,
            session_id: sessionId,
            question_id: questionId,
            participant_id: participantId,
            participant_name: participant.name,
            mime_type: response.mime_type,
            duration_ms: response.duration_ms,
            analysis_status: response.analysis_status,
            detected_language: null,
            transcript: null,
            score: null,
            analysis_json: null,
            error_message: null,
            submitted_at: response.submitted_at,
            analyzed_at: null,
          } })
        }
        const { data: signed, error: signedError } = await supabase.storage
          .from('interact-recordings')
          .createSignedUrl(response.storage_path, 3600)
        if (signedError) throw signedError
        const { storage_path: _storagePath, ...safeResponse } = response
        return jsonResponse({ response: { ...safeResponse, signed_url: signed.signedUrl } })
      }

      if (question.status !== 'active') return jsonResponse({ message: '本題已停止作答。' }, 409)

      const { data: activeSession, error: activeSessionError } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle()
      if (activeSessionError) throw activeSessionError
      if (activeSession?.status !== 'active') return jsonResponse({ message: '課程已經結束，無法送出錄音。' }, 409)

      if (action === 'prepare_recording_upload') {
        const fileSize = Number(input.fileSize)
        if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > 10 * 1024 * 1024) {
          return jsonResponse({ message: '錄音檔不可超過 10 MB。' }, 400)
        }
        const { count, error: countError } = await supabase
          .from('answers')
          .select('id', { count: 'exact', head: true })
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
        if (countError) throw countError
        if (count) return jsonResponse({ message: '本題已經送出錄音。' }, 409)
        const recordingId = crypto.randomUUID()
        const storagePath = `sessions/${sessionId}/recordings/${questionId}/${participantId}/${recordingId}.wav`
        const { data, error } = await supabase.storage.from('interact-recordings').createSignedUploadUrl(storagePath)
        if (error) throw error
        return jsonResponse({ recordingId, storagePath, uploadToken: data.token })
      }

      const recordingId = typeof input.recordingId === 'string' ? input.recordingId : ''
      const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
      const durationMs = Math.round(Number(input.durationMs))
      const expectedPath = `sessions/${sessionId}/recordings/${questionId}/${participantId}/${recordingId}.wav`
      if (!validUuid(recordingId) || storagePath !== expectedPath || durationMs < 250 || durationMs > 60_000) {
        return jsonResponse({ message: '錄音資料格式不正確。' }, 400)
      }
      const { data: audioBlob, error: downloadError } = await supabase.storage.from('interact-recordings').download(storagePath)
      if (downloadError || !audioBlob) return jsonResponse({ message: '找不到已上傳的錄音。' }, 400)
      if (audioBlob.size < 1 || audioBlob.size > 10 * 1024 * 1024) {
        await removeRecording(storagePath)
        return jsonResponse({ message: '錄音檔大小不符合限制。' }, 400)
      }

      const { data: response, error: responseError } = await supabase
        .from('audio_responses')
        .insert({
          id: recordingId,
          session_id: sessionId,
          question_id: questionId,
          participant_id: participantId,
          participant_name: participant.name,
          storage_path: storagePath,
          mime_type: 'audio/wav',
          duration_ms: durationMs,
          file_size: audioBlob.size,
        })
        .select('id, analysis_status, submitted_at')
        .single()
      if (responseError) throw responseError

      const { error: answerError } = await supabase.from('answers').insert({
        session_id: sessionId,
        question_id: questionId,
        participant_id: participantId,
        participant_name: participant.name,
        answer_text: '[錄音已送出]',
      })
      if (answerError) {
        await supabase.from('audio_responses').delete().eq('id', recordingId)
        await removeRecording(storagePath)
        throw answerError
      }

      try {
        const { data: screenshot, error: screenshotError } = await supabase
          .from('screenshots')
          .select('public_url')
          .eq('id', question.screenshot_id)
          .single()
        if (screenshotError || !screenshot?.public_url) throw new Error('找不到錄音題目的截圖。')
        const request = {
          mode: question.type as 'pronunciation' | 'oral_response',
          promptText: question.prompt_text,
          screenshotUrl: screenshot.public_url,
          audioBytes: new Uint8Array(await audioBlob.arrayBuffer()),
          audioMimeType: 'audio/wav',
        }
        let analysis = null
        let lastError: unknown = null
        for (let attempt = 0; attempt < 2 && !analysis; attempt += 1) {
          try {
            analysis = await analyzeAudioResponse(request)
          } catch (error) {
            lastError = error
          }
        }
        if (!analysis) throw lastError || new Error('Audio analysis failed.')
        await supabase.from('audio_responses').update({
          analysis_status: 'success',
          detected_language: analysis.detected_language,
          transcript: analysis.transcript,
          score: analysis.score,
          analysis_json: analysis,
          analyzed_at: new Date().toISOString(),
        }).eq('id', recordingId)
        await supabase.from('answers').update({ answer_text: '[錄音分析完成]' })
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Audio analysis failed.'
        console.error('audio analysis failed', detail)
        await supabase.from('audio_responses').update({
          analysis_status: 'failed',
          error_message: detail.slice(0, 1000),
          analyzed_at: new Date().toISOString(),
        }).eq('id', recordingId)
        await supabase.from('answers').update({ answer_text: '[錄音分析失敗]' })
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
      }
      return jsonResponse({ response })
    }

    if (action !== 'claim_buzzer' || !sessionId || !participantId) {
      return jsonResponse({ message: '不支援的學員操作。' }, 400)
    }

    const eventId = typeof input.eventId === 'string' ? input.eventId : ''
    if (!eventId) return jsonResponse({ message: '找不到這次搶答。' }, 400)

    const [{ data: session, error: sessionError }, { data: participant, error: participantError }] = await Promise.all([
      supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle(),
      supabase
        .from('participants')
        .select('id')
        .eq('id', participantId)
        .eq('session_id', sessionId)
        .maybeSingle(),
    ])
    if (sessionError) throw sessionError
    if (participantError) throw participantError
    if (!session) return jsonResponse({ message: '找不到場次。' }, 404)
    if (session.status !== 'active') return jsonResponse({ message: '課程已經結束，無法再搶答。' }, 409)
    if (!participant) return jsonResponse({ message: '找不到這位學員。' }, 404)

    const { data, error } = await supabase.rpc('claim_buzzer', {
      p_event_id: eventId,
      p_session_id: sessionId,
      p_participant_id: participantId,
    })
    if (error) throw error

    const event = Array.isArray(data) ? data[0] : data
    if (!event) return jsonResponse({ message: '這次搶答已失效。' }, 404)
    if (!event.payload?.finalized && !event.payload?.winner_id) {
      return jsonResponse({ message: '主講者尚未開始搶答，或這次搶答已失效。', event }, 409)
    }
    return jsonResponse({ event, won: event.payload?.winner_id === participantId })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Participant action failed.'
    console.error('participant-action failed', detail)
    return jsonResponse({
      message: action === 'claim_buzzer'
        ? '搶答失敗，請稍後再試。'
        : action === 'join_session'
          ? '加入場次失敗，請稍後再試。'
          : '錄音處理失敗，請稍後再試。',
    }, 500)
  }
})
