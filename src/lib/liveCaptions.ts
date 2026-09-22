import * as OpenCC from 'opencc-js'
import { liveChannelReady } from './liveChannel'
import { requireSupabase } from './supabase'
import type { Caption } from '../types'

const TARGET_SAMPLE_RATE = 24000
const PARTIAL_BROADCAST_MS = 250
const PARTIAL_TRANSLATE_MS = 800
const PARTIAL_TRANSLATE_MIN_CHARS = 4
const MAX_RECONNECT_ATTEMPTS = 8
// A sentence the server has not closed by this size or age is closed from
// here, so a lecturer who never pauses still gets captions in readable pieces
// rather than one paragraph a minute late.
const LONG_SEGMENT_CHARS = 120
const LONG_SEGMENT_MS = 8000
// No audio energy for this long while live means the microphone is not
// reaching us (muted, wrong device, tab throttled). Said, not guessed at.
const SILENCE_WARN_MS = 12000
const SILENCE_RMS = 0.004

export type CaptionStatus =
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'reconnecting'; attempt: number }
  | { state: 'silent' }
  | { state: 'error'; message: string }
  | { state: 'off' }

type CaptionRecorderOptions = {
  sessionId: string
  presenterToken: string
  vocabulary?: string
  onError: (message: string) => void
  onStatus?: (status: CaptionStatus) => void
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

function rms(samples: Float32Array) {
  let total = 0
  for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index]
  return Math.sqrt(total / Math.max(1, samples.length))
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
// server-minted ephemeral token. Word-level partials go to viewers over the
// session's shared broadcast channel; each finished sentence is stored and
// translated through the live-caption edge function, and the stored row is
// broadcast to viewers straight away.
export async function startCaptionRecorder({ sessionId, presenterToken, vocabulary = '', onError, onStatus }: CaptionRecorderOptions) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('此環境不支援錄音，無法開啟即時字幕。')

  const supabase = requireSupabase()
  const setStatus = (status: CaptionStatus) => onStatus?.(status)
  setStatus({ state: 'connecting' })

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })

  // Joined before anything is sent: a broadcast on a channel that has not
  // finished joining is dropped without a word, which is how the first
  // sentence of every class used to vanish.
  const broadcast = await liveChannelReady(sessionId)

  let lastPartialSentAt = 0
  let partialText = ''
  let partialStartedAt = 0
  // Rolling translation of the in-progress sentence so cross-language viewers
  // see the caption forming live instead of waiting for the sentence to end.
  let partialTranslation: PartialTranslation = { lang: null, zh: null, en: null }
  let lastTranslateAt = 0
  let translateInFlight = false
  let live = false

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
        // If the sentence kept growing while this request ran, chase it
        // immediately instead of waiting for the next delta.
        if (partialText && partialText !== requestedFor) translatePartial()
      })
  }

  let stopped = false
  let socket: WebSocket | null = null
  let reconnectAttempts = 0
  let reportedError = false
  const reportError = (message: string) => {
    if (reportedError) return
    reportedError = true
    setStatus({ state: 'error', message })
    onError(message)
  }

  // Forcing the end of a long sentence. If the server ever objects to a manual
  // commit while its own turn detection is on, the guard switches itself off
  // rather than bothering the teacher about it.
  let manualCommitAllowed = true
  let lastManualCommitAt = 0
  const closeLongSegment = () => {
    if (!manualCommitAllowed || socket?.readyState !== WebSocket.OPEN) return
    const now = Date.now()
    if (now - lastManualCommitAt < 2000) return
    const tooLong = partialText.length >= LONG_SEGMENT_CHARS
    const tooOld = partialStartedAt > 0 && now - partialStartedAt >= LONG_SEGMENT_MS && partialText.length >= PARTIAL_TRANSLATE_MIN_CHARS * 4
    if (!tooLong && !tooOld) return
    lastManualCommitAt = now
    socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
  }

  const finalizeSentence = (transcript: string) => {
    // Keep the last partial on viewers' screens while the finalized (and
    // fully translated) caption is being produced — clearing here left a
    // blank gap that read as latency. Viewers replace the partial themselves
    // when the finished caption arrives.
    partialText = ''
    partialStartedAt = 0
    partialTranslation = { lang: null, zh: null, en: null }
    lastTranslateAt = 0
    const text = transcript.trim()
    if (!text) return
    void supabase.functions
      .invoke('live-caption', { body: { sessionId, presenterToken, transcript: text } })
      .then(({ data, error }) => {
        if (error) throw error
        if (data?.message) throw new Error(data.message)
        reportedError = false
        const caption = data?.caption as Caption | null | undefined
        // Straight to every viewer, without waiting for the database's change
        // feed to notice the row.
        if (caption) void broadcast.send({ type: 'broadcast', event: 'final', payload: { caption } })
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
      reportedError = false
      live = true
      setStatus({ state: 'live' })
    }
    nextSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data))
        if (data.type === 'conversation.item.input_audio_transcription.delta' && typeof data.delta === 'string') {
          if (!partialText) partialStartedAt = Date.now()
          partialText += data.delta
          sendPartial(toTraditional(partialText))
          translatePartial()
          closeLongSegment()
        } else if (data.type === 'conversation.item.input_audio_transcription.completed' && typeof data.transcript === 'string') {
          finalizeSentence(data.transcript)
        } else if (data.type === 'error') {
          const message = String(data.error?.message || '')
          if (/commit/i.test(message) && /buffer|empty|vad|turn/i.test(message)) {
            // Our long-segment commit, refused. Stop sending them; the
            // server's own segmentation carries on.
            manualCommitAllowed = false
            return
          }
          reportError(message || '字幕串流發生錯誤。')
        }
      } catch {
        // Ignore malformed events; the next one resynchronizes state.
      }
    }
    nextSocket.onclose = () => {
      live = false
      if (stopped || socket !== nextSocket) return
      reconnectAttempts += 1
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        reportError('字幕連線中斷，請關閉字幕後再重新開啟。')
        return
      }
      setStatus({ state: 'reconnecting', attempt: reconnectAttempts })
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
  let lastLoudAt = Date.now()
  let silentWarned = false
  processor.onaudioprocess = (event) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    const now = Date.now()
    if (rms(input) > SILENCE_RMS) {
      lastLoudAt = now
      if (silentWarned && live) {
        silentWarned = false
        setStatus({ state: 'live' })
      }
    } else if (live && !silentWarned && now - lastLoudAt > SILENCE_WARN_MS) {
      silentWarned = true
      setStatus({ state: 'silent' })
    }
    if (socket?.readyState !== WebSocket.OPEN) return
    const samples = downsampleTo24k(input, audioContext.sampleRate)
    socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: floatToPcm16Base64(samples) }))
  }
  source.connect(processor)
  processor.connect(audioContext.destination)

  // A browser suspends the audio graph when it feels like it — tab hidden, a
  // policy that wants a gesture first — and a suspended graph sends nothing
  // and says nothing. Resume it now and every time the page comes back.
  const resumeAudio = () => {
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => null)
  }
  resumeAudio()
  document.addEventListener('visibilitychange', resumeAudio)
  const resumeTimer = window.setInterval(resumeAudio, 5000)

  const teardown = () => {
    window.clearInterval(resumeTimer)
    document.removeEventListener('visibilitychange', resumeAudio)
    processor.disconnect()
    source.disconnect()
    void audioContext.close()
    stream.getTracks().forEach((track) => track.stop())
  }

  try {
    await connect()
  } catch (caught) {
    teardown()
    setStatus({ state: 'off' })
    throw caught
  }

  return () => {
    stopped = true
    socket?.close()
    teardown()
    sendPartial('', true)
    setStatus({ state: 'off' })
  }
}
