import * as OpenCC from 'opencc-js'
import { requireSupabase } from './supabase'

const TARGET_SAMPLE_RATE = 24000
const PARTIAL_BROADCAST_MS = 250
const PARTIAL_TRANSLATE_MS = 2200
const PARTIAL_TRANSLATE_MIN_CHARS = 6
const MAX_RECONNECT_ATTEMPTS = 5

type CaptionRecorderOptions = {
  sessionId: string
  presenterToken: string
  vocabulary?: string
  onError: (message: string) => void
}

type PartialTranslation = { lang: string | null; zh: string | null; en: string | null }

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' })

function downsampleTo24k(samples: Float32Array, sourceRate: number) {
  if (sourceRate === TARGET_SAMPLE_RATE) return samples
  const ratio = sourceRate / TARGET_SAMPLE_RATE
  const result = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)))
  for (let index = 0; index < result.length; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio))
    let total = 0
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) total += samples[sourceIndex]
    result[index] = total / Math.max(1, end - start)
  }
  return result
}

function floatToPcm16Base64(samples: Float32Array) {
  const pcm = new Uint8Array(samples.length * 2)
  const view = new DataView(pcm.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < pcm.length; index += chunkSize) {
    binary += String.fromCharCode(...pcm.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function mintStreamToken(sessionId: string, presenterToken: string, vocabulary: string) {
  const { data, error } = await requireSupabase().functions.invoke('caption-token', {
    body: { sessionId, presenterToken, vocabulary },
  })
  if (error) throw new Error('無法建立字幕連線，請稍後再試。')
  if (typeof data?.token !== 'string' || !data.token) throw new Error(data?.message || '無法建立字幕連線。')
  return data.token as string
}

// Streams microphone audio to OpenAI Realtime transcription with a
// server-minted ephemeral token. Word-level partials go to viewers over a
// Supabase broadcast channel; each VAD-finalized sentence is stored (and
// translated) through the live-caption edge function.
export async function startCaptionRecorder({ sessionId, presenterToken, vocabulary = '', onError }: CaptionRecorderOptions) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('此環境不支援錄音，無法開啟即時字幕。')

  const supabase = requireSupabase()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })

  const broadcast = supabase.channel(`caption-live:${sessionId}`)
  broadcast.subscribe()
  let lastPartialSentAt = 0
  let partialText = ''
  // Rolling translation of the in-progress sentence so cross-language viewers
  // see the caption forming live instead of waiting for the sentence to end.
  let partialTranslation: PartialTranslation = { lang: null, zh: null, en: null }
  let lastTranslateAt = 0
  let translateInFlight = false

  const sendPartial = (text: string, force = false) => {
    const now = Date.now()
    if (!force && now - lastPartialSentAt < PARTIAL_BROADCAST_MS) return
    lastPartialSentAt = now
    void broadcast.send({
      type: 'broadcast',
      event: 'partial',
      payload: { text, lang: partialTranslation.lang, zh: partialTranslation.zh, en: partialTranslation.en },
    })
  }

  const translatePartial = () => {
    const now = Date.now()
    if (translateInFlight || partialText.length < PARTIAL_TRANSLATE_MIN_CHARS || now - lastTranslateAt < PARTIAL_TRANSLATE_MS) return
    translateInFlight = true
    lastTranslateAt = now
    const requestedFor = partialText
    void supabase.functions
      .invoke('live-caption', { body: { sessionId, presenterToken, transcript: requestedFor, translateOnly: true } })
      .then(({ data }) => {
        const translation = data?.translation as PartialTranslation | undefined
        // Ignore if the sentence has been finalized since the request began.
        if (!translation || !partialText) return
        partialTranslation = translation
        sendPartial(toTraditional(partialText), true)
      })
      .catch(() => null)
      .finally(() => {
        translateInFlight = false
      })
  }

  let stopped = false
  let socket: WebSocket | null = null
  let reconnectAttempts = 0
  let reportedError = false
  const reportError = (message: string) => {
    if (reportedError) return
    reportedError = true
    onError(message)
  }

  const finalizeSentence = (transcript: string) => {
    partialText = ''
    partialTranslation = { lang: null, zh: null, en: null }
    sendPartial('', true)
    const text = transcript.trim()
    if (!text) return
    void supabase.functions
      .invoke('live-caption', { body: { sessionId, presenterToken, transcript: text } })
      .then(({ data, error }) => {
        if (error) throw error
        if (data?.message) throw new Error(data.message)
        reportedError = false
      })
      .catch((caught: unknown) => {
        reportError(caught instanceof Error ? caught.message : '字幕儲存失敗。')
      })
  }

  const connect = async () => {
    if (stopped) return
    const token = await mintStreamToken(sessionId, presenterToken, vocabulary)
    if (stopped) return

    const nextSocket = new WebSocket('wss://api.openai.com/v1/realtime', [
      'realtime',
      `openai-insecure-api-key.${token}`,
    ])
    socket = nextSocket

    nextSocket.onopen = () => {
      reconnectAttempts = 0
    }
    nextSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data))
        if (data.type === 'conversation.item.input_audio_transcription.delta' && typeof data.delta === 'string') {
          partialText += data.delta
          sendPartial(toTraditional(partialText))
          translatePartial()
        } else if (data.type === 'conversation.item.input_audio_transcription.completed' && typeof data.transcript === 'string') {
          finalizeSentence(data.transcript)
        } else if (data.type === 'error') {
          reportError(String(data.error?.message || '字幕串流發生錯誤。'))
        }
      } catch {
        // Ignore malformed events; the next one resynchronizes state.
      }
    }
    nextSocket.onclose = () => {
      if (stopped || socket !== nextSocket) return
      reconnectAttempts += 1
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        reportError('字幕連線中斷，請關閉字幕後再重新開啟。')
        return
      }
      window.setTimeout(() => {
        connect().catch((caught: unknown) => {
          reportError(caught instanceof Error ? caught.message : '字幕連線中斷。')
        })
      }, Math.min(8000, 500 * 2 ** reconnectAttempts))
    }
  }

  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but works everywhere without a worker,
  // which the app's CSP (script-src 'self') would block as a blob module.
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (event) => {
    if (stopped || socket?.readyState !== WebSocket.OPEN) return
    const samples = downsampleTo24k(event.inputBuffer.getChannelData(0), audioContext.sampleRate)
    socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: floatToPcm16Base64(samples) }))
  }
  source.connect(processor)
  processor.connect(audioContext.destination)

  try {
    await connect()
  } catch (caught) {
    processor.disconnect()
    source.disconnect()
    void audioContext.close()
    stream.getTracks().forEach((track) => track.stop())
    supabase.removeChannel(broadcast)
    throw caught
  }

  return () => {
    stopped = true
    socket?.close()
    processor.disconnect()
    source.disconnect()
    void audioContext.close()
    stream.getTracks().forEach((track) => track.stop())
    sendPartial('', true)
    supabase.removeChannel(broadcast)
  }
}
