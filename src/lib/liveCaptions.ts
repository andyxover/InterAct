import { requireSupabase } from './supabase'

export type LiveCaptionEvent = {
  language: string
  text: string
  final: boolean
}

type RealtimeCaptionConnection = {
  close: () => void
}

type ConnectionOptions = {
  sessionId: string
  presenterToken: string
  mode: 'transcription' | 'translation'
  language: string
  stream: MediaStream
  includeSourceEvents?: boolean
  sourceLanguage: string
  onCaption: (event: LiveCaptionEvent) => void
  onError: (message: string) => void
}

function eventText(event: Record<string, unknown>) {
  const value = event.delta ?? event.transcript ?? event.text
  return typeof value === 'string' ? value : ''
}

async function functionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return '即時字幕服務連線失敗。'
  const response = (error as Error & { context?: Response }).context
  if (response) {
    try {
      const body = await response.clone().json()
      if (typeof body?.message === 'string') return body.message
    } catch {
      // Fall through to the SDK error message.
    }
  }
  return error.message
}

export async function createRealtimeCaptionConnection(options: ConnectionOptions): Promise<RealtimeCaptionConnection> {
  const { data, error } = await requireSupabase().functions.invoke('openai-realtime-session', {
    body: {
      sessionId: options.sessionId,
      presenterToken: options.presenterToken,
      mode: options.mode,
      targetLanguage: options.mode === 'translation' ? options.language : undefined,
    },
  })
  if (error) throw new Error(await functionErrorMessage(error))
  if (!data?.clientSecret) throw new Error(data?.message || '沒有取得即時字幕連線權限。')

  const peer = new RTCPeerConnection()
  const dataChannel = peer.createDataChannel('oai-events')
  for (const track of options.stream.getAudioTracks()) peer.addTrack(track, options.stream)

  const buffers = new Map<string, string>()
  const finalizeTimers = new Map<string, number>()
  const emit = (language: string, text: string, final: boolean) => {
    const normalized = text.trim()
    if (normalized) options.onCaption({ language, text: normalized, final })
  }

  dataChannel.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(message.data) as Record<string, unknown>
      const type = typeof event.type === 'string' ? event.type : ''
      const isTranscription = type.includes('input_audio_transcription')
      const isTranslationSource = type.startsWith('session.input_transcript.')
      const isTranslationOutput = type.startsWith('session.output_transcript.')
      if (!isTranscription && !isTranslationSource && !isTranslationOutput) return
      if (isTranslationSource && !options.includeSourceEvents) return

      const language = isTranslationOutput ? options.language : options.sourceLanguage
      const itemId = typeof event.item_id === 'string' ? event.item_id : ''
      const key = `${type.split('.').slice(0, -1).join('.')}:${language}:${itemId}`
      const text = eventText(event)
      if (type.endsWith('.delta')) {
        const next = `${buffers.get(key) || ''}${text}`
        buffers.set(key, next)
        emit(language, next, false)
        if (isTranslationSource || isTranslationOutput) {
          window.clearTimeout(finalizeTimers.get(key))
          finalizeTimers.set(key, window.setTimeout(() => {
            const finalText = buffers.get(key) || ''
            buffers.delete(key)
            finalizeTimers.delete(key)
            emit(language, finalText, true)
          }, 1200))
        }
      } else if (type.endsWith('.completed') || type.endsWith('.done')) {
        window.clearTimeout(finalizeTimers.get(key))
        finalizeTimers.delete(key)
        const finalText = text || buffers.get(key) || ''
        buffers.delete(key)
        emit(language, finalText, true)
      }
    } catch {
      // Ignore non-JSON WebRTC messages.
    }
  })
  dataChannel.addEventListener('error', () => options.onError('即時字幕資料連線發生錯誤。'))

  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  const endpoint = options.mode === 'translation'
    ? 'https://api.openai.com/v1/realtime/translations/calls'
    : 'https://api.openai.com/v1/realtime/calls'
  const answerResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.clientSecret}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  })
  if (!answerResponse.ok) throw new Error(`即時字幕連線失敗 (${answerResponse.status})。`)
  await peer.setRemoteDescription({ type: 'answer', sdp: await answerResponse.text() })

  return {
    close() {
      for (const timer of finalizeTimers.values()) window.clearTimeout(timer)
      dataChannel.close()
      peer.close()
    },
  }
}
