import * as OpenCC from 'opencc-js'
import { liveChannelReady } from './liveChannel'
import { requireSupabase } from './supabase'
import type { Caption } from '../types'

const TARGET_SAMPLE_RATE = 24000
const PARTIAL_BROADCAST_MS = 250
const PARTIAL_TRANSLATE_MS = 800
const PARTIAL_TRANSLATE_MIN_CHARS = 4
const MAX_RECONNECT_ATTEMPTS = 8
// Segmenting is done here. gpt-live-transcribe streams words as they are
// said and leaves it to the client to say where a turn ends; the older
// models had the server's VAD do it. A turn ends at half a second of
// silence after speech — a phrase boundary, which is what a caption should
// be — or, for a lecturer who never pauses, at this many characters or
// seconds of speech.
const SEGMENT_SILENCE_MS = 400
const MIN_SEGMENT_SPEECH_MS = 400
const LONG_SEGMENT_CHARS = 120
const LONG_SEGMENT_MS = 8000
// When a long turn must be cut, wait this long for a brief quiet moment so
// the cut lands between words, not inside one.
const LONG_CUT_GRACE_MS = 2000
// Audio captured while the socket is still connecting is kept, not dropped:
// the teacher starts talking the moment they press the toggle.
const PRECONNECT_BUFFER_MS = 6000
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

export type CaptionActivity = 'hearing' | 'transcribing' | 'translating'

type CaptionRecorderOptions = {
  sessionId: string
  presenterToken: string
  vocabulary?: string
  onError: (message: string) => void
  onStatus?: (status: CaptionStatus) => void
  /** Microphone level, 0–1, a few times a second. */
  onLevel?: (level: number) => void
  /** Something just happened in the pipeline. */
  onActivity?: (activity: CaptionActivity) => void
}
const LEVEL_MS = 80
const LEVEL_FULL_RMS = 0.12

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
  // clientCommits: the server has no turn detection and expects us to end
  // each turn (gpt-live-transcribe). Otherwise the server's VAD does it.
  return { token: data.token as string, clientCommits: data?.clientCommits === true }
}

// Streams microphone audio to OpenAI Realtime transcription with a
// server-minted ephemeral token. Word-level partials go to viewers over the
// session's shared broadcast channel; each finished sentence is stored and
// translated through the live-caption edge function, and the stored row is
// broadcast to viewers straight away.
export async function startCaptionRecorder({ sessionId, presenterToken, vocabulary = '', onError, onStatus, onLevel, onActivity }: CaptionRecorderOptions) {
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
  // The in-progress text, by item: with client-side turns a delta for the
  // next turn can arrive before the completion of the previous one, and the
  // two must not be glued together. What viewers see is the newest item.
  const partialByItem = new Map<string, string>()
  let partialItem = ''
  let partialText = ''
  let partialStartedAt = 0
  let clientCommits = false
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
    onActivity?.('translating')
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
  const preconnect: string[] = []
  let lastFinal: { text: string; at: number } | null = null
  // A turn cut by us sometimes re-emits the last word of the previous turn
  // at the start of the next ("…five sixths." / "Sixths, any questions?").
  // Dropped only when the text starts with the exact last word of a turn
  // that ended a moment ago; a genuine repeat that far apart is a
  // coincidence we accept. Applied to the partial on screen and to the
  // stored line alike, so they agree.
  const trimOverlap = (raw: string) => {
    if (!lastFinal || Date.now() - lastFinal.at > 4000) return raw
    const tail = lastFinal.text.replace(/[\s.,!?。，！？；;:：]+$/u, '')
    const lastWord = /[\u4e00-\u9fff]$/u.test(tail) ? tail.slice(-2) : (tail.split(/\s+/).pop() ?? '')
    const head = raw.replace(/^[\s.,!?。，！？；;:：]+/u, '')
    if (lastWord.length < 2 || !head.toLowerCase().startsWith(lastWord.toLowerCase())) return raw
    const rest = head.slice(lastWord.length).replace(/^[\s.,!?。，！？；;:：]+/u, '')
    return rest.length >= 2 ? rest.charAt(0).toUpperCase() + rest.slice(1) : raw
  }
  let preconnectMs = 0
  let reconnectAttempts = 0
  let reportedError = false
  const reportError = (message: string) => {
    if (reportedError) return
    reportedError = true
    setStatus({ state: 'error', message })
    onError(message)
  }

  // Ending a turn. Sent when speech has paused, or when the turn has grown
  // long. Never on an empty buffer — the server refuses that — and never
  // twice in quick succession. If the server ever objects (an older model
  // with its own turn detection), the guard switches itself off rather than
  // bothering the teacher about it.
  let manualCommitAllowed = true
  let lastCommitAt = 0
  let speechSinceCommitMs = 0
  let audioSinceCommitMs = 0
  let lastSpeechAt = 0
  const commitTurn = (reason: 'silence' | 'long') => {
    if (!manualCommitAllowed || socket?.readyState !== WebSocket.OPEN) return
    const now = Date.now()
    if (now - lastCommitAt < 1000) return
    if (speechSinceCommitMs < MIN_SEGMENT_SPEECH_MS || audioSinceCommitMs < 200) return
    lastCommitAt = now
    speechSinceCommitMs = 0
    audioSinceCommitMs = 0
    longCutPendingSince = 0
    socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    if (reason === 'long') partialStartedAt = now
  }
  // A long turn is not cut on the spot: the audio loop waits for the next
  // quiet chunk (a breath between words) and cuts there, or after a short
  // grace period regardless.
  let longCutPendingSince = 0
  const closeLongSegment = () => {
    if (longCutPendingSince) return
    const now = Date.now()
    const tooLong = partialText.length >= LONG_SEGMENT_CHARS
    const tooOld = partialStartedAt > 0 && now - partialStartedAt >= LONG_SEGMENT_MS && partialText.length >= PARTIAL_TRANSLATE_MIN_CHARS * 4
    if (tooLong || tooOld) longCutPendingSince = now
  }

  const finalizeSentence = (transcript: string, itemId: string) => {
    // Keep the last partial on viewers' screens while the finalized (and
    // fully translated) caption is being produced — clearing here left a
    // blank gap that read as latency. Viewers replace the partial themselves
    // when the finished caption arrives.
    partialByItem.delete(itemId)
    if (itemId === partialItem || !partialByItem.size) {
      partialItem = ''
      partialText = ''
      partialStartedAt = 0
      partialTranslation = { lang: null, zh: null, en: null }
      lastTranslateAt = 0
    }
    // The live model writes Chinese in Simplified characters; the class reads
    // Traditional. Converted here so the stored line matches the screen.
    const text = trimOverlap(toTraditional(transcript.trim()))
    if (!text) return
    lastFinal = { text, at: Date.now() }
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
    const minted = await mintStreamToken(sessionId, presenterToken, vocabulary)
    if (stopped) return
    const token = minted.token
    clientCommits = minted.clientCommits

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
      // What was said while we were connecting.
      for (const chunk of preconnect) nextSocket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk }))
      preconnect.length = 0
      preconnectMs = 0
    }
    nextSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data))
        if (data.type === 'conversation.item.input_audio_transcription.delta' && typeof data.delta === 'string') {
          const itemId = typeof data.item_id === 'string' ? data.item_id : 'current'
          if (itemId !== partialItem) {
            // A new turn has started streaming. Show it from here on.
            partialItem = itemId
            partialText = partialByItem.get(itemId) ?? ''
            partialTranslation = { lang: null, zh: null, en: null }
            lastTranslateAt = 0
            if (!partialText) partialStartedAt = Date.now()
          }
          partialText += data.delta
          partialByItem.set(itemId, partialText)
          onActivity?.('transcribing')
          sendPartial(trimOverlap(toTraditional(partialText)))
          translatePartial()
          closeLongSegment()
        } else if (data.type === 'conversation.item.input_audio_transcription.completed' && typeof data.transcript === 'string') {
          finalizeSentence(data.transcript, typeof data.item_id === 'string' ? data.item_id : 'current')
        } else if (data.type === 'error') {
          const message = String(data.error?.message || '')
          if (/commit/i.test(message) && /buffer|empty|vad|turn|small/i.test(message)) {
            // A commit the server did not want (empty buffer, or a model with
            // its own turn detection). Not the teacher's problem.
            if (!clientCommits) manualCommitAllowed = false
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
  let lastLevelAt = 0
  processor.onaudioprocess = (event) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    const now = Date.now()
    const energy = rms(input)
    if (onLevel && now - lastLevelAt >= LEVEL_MS) {
      lastLevelAt = now
      onLevel(Math.min(1, energy / LEVEL_FULL_RMS))
    }
    if (energy > SILENCE_RMS) {
      lastLoudAt = now
      if (live) onActivity?.('hearing')
      if (silentWarned && live) {
        silentWarned = false
        setStatus({ state: 'live' })
      }
    } else if (live && !silentWarned && now - lastLoudAt > SILENCE_WARN_MS) {
      silentWarned = true
      setStatus({ state: 'silent' })
    }
    const samples = downsampleTo24k(input, audioContext.sampleRate)
    const encoded = floatToPcm16Base64(samples)
    const durationMs = (input.length / audioContext.sampleRate) * 1000
    if (socket?.readyState !== WebSocket.OPEN) {
      // Keep the last few seconds for the socket to catch up on.
      preconnect.push(encoded)
      preconnectMs += durationMs
      while (preconnectMs > PRECONNECT_BUFFER_MS && preconnect.length) { preconnect.shift(); preconnectMs -= durationMs }
      return
    }
    socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: encoded }))
    // Our own turn-taking: this buffer is ~85 ms of audio.
    audioSinceCommitMs += durationMs
    const loud = rms(input) > SILENCE_RMS
    if (loud) {
      speechSinceCommitMs += durationMs
      lastSpeechAt = now
    }
    if (!clientCommits) return
    if (!loud && speechSinceCommitMs >= MIN_SEGMENT_SPEECH_MS && now - lastSpeechAt >= SEGMENT_SILENCE_MS) {
      commitTurn('silence')
    } else if (longCutPendingSince && (!loud || now - longCutPendingSince >= LONG_CUT_GRACE_MS)) {
      commitTurn('long')
    }
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
