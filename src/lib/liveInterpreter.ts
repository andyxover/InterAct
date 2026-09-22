import { onLiveEvent, sendLive } from './liveChannel'
import { requireSupabase } from './supabase'

// The live interpreter: the presenter's voice, translated as speech while
// they are still talking.
//
// One OpenAI translation session streams microphone audio up and translated
// audio (24 kHz PCM) plus translated text back, phrase by phrase, about a
// second behind the speaker. Where that audio goes is the presenter's choice:
//
//   device — an output on this machine. A SKAA transmitter, so every student
//            holding a SKAA headphone hears it with radio latency and nothing
//            to install. Never the room's speakers, which the microphone would
//            hear and translate again.
//   phones — each listening student's phone, over WebRTC straight from this
//            laptop across the classroom network. The signalling (offer,
//            answer, ICE) rides the session's broadcast channel; a phone that
//            cannot connect falls back on its own to spoken captions.
//
// Both at once is fine: some students on headphones, the rest on phones.

export type InterpreterLanguage = 'en' | 'zh'
export type InterpreterOutput = 'device' | 'phones' | 'both'
/**
 * Whose voice the class hears.
 *   adaptive — the translation model's own: it follows the presenter's tone,
 *              pitch and pace phrase by phrase, and cannot be told otherwise.
 *              Fastest; sounds like a different person from sentence to
 *              sentence when the presenter's delivery varies.
 *   steady   — one fixed voice, in a manner the presenter wrote, reading the
 *              model's translated text sentence by sentence. About a second
 *              further behind, and always the same person.
 */
export type InterpreterVoice = 'adaptive' | 'steady'
/** Steady voice: the manner can be set ('expressive', gpt-4o-mini-tts) or the first word comes sooner ('fast', tts-1). */
export type SteadyModel = 'expressive' | 'fast'
/** What the pipeline is doing right now, for a meter on the presenter's screen. */
export type InterpreterActivity = 'hearing' | 'translating' | 'speaking'

export type InterpreterStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | { state: 'live'; listeners: number }
  | { state: 'reconnecting'; attempt: number }
  | { state: 'silent' }
  | { state: 'error'; message: string }

export type OutputDevice = { deviceId: string; label: string }

type Options = {
  sessionId: string
  presenterToken: string
  language: InterpreterLanguage
  output: InterpreterOutput
  /** Output device id from listOutputDevices(); empty for the system default. */
  outputDeviceId?: string
  voice?: InterpreterVoice
  /** 'steady' only: the text-to-speech voice, and the manner it should read in. */
  steadyVoice?: string
  steadyModel?: SteadyModel
  tone?: string
  onStatus?: (status: InterpreterStatus) => void
  /** The translation so far, for a line on the presenter's screen. */
  onText?: (text: string) => void
  /** Microphone level, 0–1, a few times a second. */
  onLevel?: (level: number) => void
  /** Something just happened in the pipeline. */
  onActivity?: (activity: InterpreterActivity) => void
}

const SAMPLE_RATE = 24000
const MAX_RECONNECT_ATTEMPTS = 8
const LEAD_S = 0.05
const KEEP_TEXT_CHARS = 400
const SILENCE_WARN_MS = 12000
const SILENCE_RMS = 0.004
const STATE_HEARTBEAT_MS = 8000
const MAX_PEERS = 60
const DISCONNECT_GRACE_MS = 10000
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
// Level reports are throttled to this; a meter does not need more.
const LEVEL_MS = 80
// A microphone at conversational volume sits around this RMS; treated as full scale.
const LEVEL_FULL_RMS = 0.12
// Steady voice: a sentence is read when it ends in punctuation, when it has
// grown to this many characters, or when nothing more has arrived for this
// long. Short fragments wait for the rest of the phrase.
const SENTENCE_MAX_CHARS = 160
const SENTENCE_IDLE_MS = 900
const SENTENCE_MIN_CHARS = 4
const SENTENCE_END = /[.!?。！？]["'”’)]?\s*$/u

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * One sentence, spoken in the fixed voice, as 24 kHz PCM16 arriving in
 * chunks: `onChunk` gets each piece the moment it lands so the sentence can
 * start playing while the rest is still being made. Resolves when the
 * sentence is complete; rejects when nothing usable came back.
 */
async function speakSentence(
  sessionId: string, presenterToken: string, text: string, lang: InterpreterLanguage, voice: string, tone: string, model: 'expressive' | 'fast',
  onChunk: (samples: Float32Array) => void,
) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase 尚未設定。')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/interp-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ sessionId, presenterToken, text, lang, voice, tone, model }),
  })
  if (!res.ok || !res.body) {
    const message = await res.json().then((d: { message?: string }) => d?.message).catch(() => null)
    throw new Error(message || '口譯語音產生失敗。')
  }
  const reader = res.body.getReader()
  // PCM16 is two bytes a sample; a chunk boundary can fall between them.
  let carry: Uint8Array = new Uint8Array(0)
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const bytes = carry.length ? new Uint8Array([...carry, ...value]) : value
    const usable = bytes.length - (bytes.length % 2)
    carry = bytes.subarray(usable)
    if (!usable) continue
    const view = new DataView(bytes.buffer, bytes.byteOffset, usable)
    const samples = new Float32Array(usable / 2)
    for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 0x8000
    total += samples.length
    onChunk(samples)
  }
  if (!total) throw new Error('口譯語音產生失敗。')
}

/** A no-op call that gets the speech function's instance warm before the first sentence needs it. */
function warmSpeech() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return
  // An empty request the function rejects at once (400) - it has run, which is the point.
  void fetch(`${SUPABASE_URL}/functions/v1/interp-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: '{}',
  }).catch(() => null)
}

async function mintTranslationToken(sessionId: string, presenterToken: string, language: InterpreterLanguage) {
  const { data, error } = await requireSupabase().functions.invoke('translate-token', {
    body: { sessionId, presenterToken, language },
  })
  if (error) throw new Error('無法建立口譯連線，請稍後再試。')
  if (typeof data?.token !== 'string' || !data.token) throw new Error(data?.message || '無法建立口譯連線。')
  return data.token as string
}

function downsampleTo24k(samples: Float32Array, sourceRate: number) {
  if (sourceRate === SAMPLE_RATE) return samples
  const ratio = sourceRate / SAMPLE_RATE
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

function pcm16Base64ToFloat32(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const view = new DataView(bytes.buffer)
  const samples = new Float32Array(Math.floor(bytes.length / 2))
  for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true) / 0x8000
  return samples
}

function rms(samples: Float32Array) {
  let total = 0
  for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index]
  return Math.sqrt(total / Math.max(1, samples.length))
}

/**
 * Every audio output this machine has. Labels are only revealed once the
 * microphone has been granted, so the list fills in properly after captions
 * or the interpreter have run once.
 */
export async function listOutputDevices(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `輸出裝置 ${index + 1}` }))
}

type SinkAudioContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }

export async function startInterpreter({ sessionId, presenterToken, language, output, outputDeviceId = '', voice = 'adaptive', steadyVoice = 'marin', steadyModel = 'expressive', tone = '', onStatus, onText, onLevel, onActivity }: Options) {
  const setStatus = (status: InterpreterStatus) => onStatus?.(status)
  setStatus({ state: 'connecting' })
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('此環境不支援錄音，無法開啟口譯。')
  const toDevice = output === 'device' || output === 'both'
  const toPhones = output === 'phones' || output === 'both'

  // Output graph: one context. The device path is the context's own
  // destination (on the chosen sink); the phones path is a MediaStream
  // destination whose track every peer connection carries.
  const outCtx = new AudioContext({ sampleRate: SAMPLE_RATE }) as SinkAudioContext
  if (toDevice && outputDeviceId && outputDeviceId !== 'default') {
    if (typeof outCtx.setSinkId !== 'function') {
      void outCtx.close()
      throw new Error('這個環境無法選擇音訊輸出裝置。')
    }
    try {
      await outCtx.setSinkId(outputDeviceId)
    } catch {
      void outCtx.close()
      throw new Error('找不到選擇的輸出裝置，請重新整理裝置清單後再選一次。')
    }
  }
  const phoneDestination = toPhones ? outCtx.createMediaStreamDestination() : null

  // Input: the microphone, as 24 kHz PCM16. Echo cancellation stays on so
  // whatever leaks from an output into the room is not fed back.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  }).catch(() => { void outCtx.close(); throw new Error('無法使用麥克風，請確認已允許 InterAct 錄音。') })
  const inCtx = new AudioContext()
  const source = inCtx.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but works everywhere without a worker,
  // which the app's CSP (script-src 'self') would block as a blob module.
  const processor = inCtx.createScriptProcessor(4096, 1, 1)

  let stopped = false
  let socket: WebSocket | null = null
  let reconnectAttempts = 0
  let live = false
  let nextPlayAt = 0
  let text = ''
  let lastLoudAt = Date.now()
  let silentWarned = false
  let lastLevelAt = 0
  const peers = new Map<string, RTCPeerConnection>()

  const refreshStatus = () => {
    if (stopped || !live || silentWarned) return
    setStatus({ state: 'live', listeners: peers.size })
  }

  processor.onaudioprocess = (event) => {
    if (stopped) return
    const samples = event.inputBuffer.getChannelData(0)
    const now = Date.now()
    const energy = rms(samples)
    if (onLevel && now - lastLevelAt >= LEVEL_MS) {
      lastLevelAt = now
      onLevel(Math.min(1, energy / LEVEL_FULL_RMS))
    }
    if (energy > SILENCE_RMS) {
      lastLoudAt = now
      if (live) onActivity?.('hearing')
      if (silentWarned && live) { silentWarned = false; refreshStatus() }
    } else if (live && !silentWarned && now - lastLoudAt > SILENCE_WARN_MS) {
      silentWarned = true
      setStatus({ state: 'silent' })
    }
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({
      type: 'session.input_audio_buffer.append',
      audio: floatToPcm16Base64(downsampleTo24k(samples, inCtx.sampleRate)),
    }))
  }
  source.connect(processor)
  processor.connect(inCtx.destination)

  const resume = () => {
    if (inCtx.state === 'suspended') void inCtx.resume().catch(() => null)
    if (outCtx.state === 'suspended') void outCtx.resume().catch(() => null)
  }
  resume()
  document.addEventListener('visibilitychange', resume)
  const resumeTimer = window.setInterval(resume, 5000)

  const schedule = (buffer: AudioBuffer) => {
    const node = outCtx.createBufferSource()
    node.buffer = buffer
    if (toDevice) node.connect(outCtx.destination)
    if (phoneDestination) node.connect(phoneDestination)
    const startAt = Math.max(outCtx.currentTime + LEAD_S, nextPlayAt)
    node.start(startAt)
    nextPlayAt = startAt + buffer.duration
    onActivity?.('speaking')
  }

  const play = (base64: string) => {
    const samples = pcm16Base64ToFloat32(base64)
    if (!samples.length) return
    const buffer = outCtx.createBuffer(1, samples.length, SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    schedule(buffer)
  }

  // --- Steady voice: the translated text, read sentence by sentence ---------
  //
  // Sentences are fetched as soon as they are complete, several at a time,
  // and played strictly in order; a sentence that fails to synthesise is
  // skipped rather than holding up the ones after it.
  const steady = voice === 'steady'
  if (steady) warmSpeech()
  let sentence = ''
  let sentenceIdle = 0
  let playChain: Promise<void> = Promise.resolve()
  const playSamples = (samples: Float32Array) => {
    if (!samples.length || stopped) return
    const buffer = outCtx.createBuffer(1, samples.length, SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    schedule(buffer)
  }
  const flushSentence = () => {
    window.clearTimeout(sentenceIdle)
    sentenceIdle = 0
    const text = sentence.trim()
    sentence = ''
    if (text.length < SENTENCE_MIN_CHARS || stopped) return
    // Fetching starts now, so the audio is usually waiting by the time this
    // sentence's turn comes; playing waits for the sentence before it.
    const chunks: Float32Array[] = []
    let wake: (() => void) | null = null
    let finished = false
    const fetched = speakSentence(sessionId, presenterToken, text, language, steadyVoice, tone, steadyModel, (samples) => {
      chunks.push(samples)
      wake?.()
    }).catch(() => null).finally(() => { finished = true; wake?.() })
    playChain = playChain.then(async () => {
      for (;;) {
        while (chunks.length) playSamples(chunks.shift() as Float32Array)
        if (finished || stopped) break
        await new Promise<void>((resolve) => { wake = resolve })
        wake = null
      }
      await fetched
    })
  }
  const takeTranscript = (delta: string) => {
    sentence += delta
    onActivity?.('translating')
    if (SENTENCE_END.test(sentence) || sentence.length >= SENTENCE_MAX_CHARS) {
      flushSentence()
      return
    }
    window.clearTimeout(sentenceIdle)
    sentenceIdle = window.setTimeout(flushSentence, SENTENCE_IDLE_MS)
  }

  // --- The translation socket ---------------------------------------------

  const connect = async () => {
    if (stopped) return
    const token = await mintTranslationToken(sessionId, presenterToken, language)
    if (stopped) return
    const nextSocket = new WebSocket('wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate', [
      'realtime',
      `openai-insecure-api-key.${token}`,
    ])
    socket = nextSocket
    nextSocket.onopen = () => {
      reconnectAttempts = 0
      live = true
      nextSocket.send(JSON.stringify({ type: 'session.update', session: { audio: { output: { language } } } }))
      refreshStatus()
      announce()
    }
    nextSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data))
        if (data.type === 'session.output_audio.delta' && typeof data.delta === 'string') {
          // In steady mode the model's own voice is not played; its text is.
          if (!steady) play(data.delta)
          else onActivity?.('translating')
        } else if (data.type === 'session.output_transcript.delta' && typeof data.delta === 'string') {
          text = (text + data.delta).slice(-KEEP_TEXT_CHARS)
          onText?.(text)
          if (steady) takeTranscript(data.delta)
        } else if (data.type === 'error') {
          setStatus({ state: 'error', message: String(data.error?.message || '口譯串流發生錯誤。') })
        }
      } catch {
        // Malformed event; the next one resynchronises.
      }
    }
    nextSocket.onclose = () => {
      live = false
      if (stopped || socket !== nextSocket) return
      reconnectAttempts += 1
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        setStatus({ state: 'error', message: '口譯連線中斷，請關閉口譯後再重新開啟。' })
        announce()
        return
      }
      setStatus({ state: 'reconnecting', attempt: reconnectAttempts })
      window.setTimeout(() => {
        connect().catch((caught: unknown) => {
          setStatus({ state: 'error', message: caught instanceof Error ? caught.message : '口譯連線中斷。' })
        })
      }, Math.min(8000, 500 * 2 ** reconnectAttempts))
    }
  }

  // --- Phones, over WebRTC -------------------------------------------------
  //
  // The presenter announces "interpreting into <language>" every few seconds
  // and whenever it changes. A phone that wants it sends an offer; the
  // presenter answers with the translated-audio track attached. Everything
  // rides the session channel by name; nothing here touches the database.

  const announce = () => {
    void sendLive(sessionId, 'interp-state', {
      on: !stopped && live && toPhones,
      language,
    })
  }

  const closePeer = (participantId: string) => {
    const pc = peers.get(participantId)
    if (!pc) return
    pc.close()
    peers.delete(participantId)
    refreshStatus()
  }

  const handleOffer = async (payload: unknown) => {
    if (!phoneDestination || stopped) return
    const { participantId, lang, sdp } = (payload ?? {}) as { participantId?: unknown; lang?: unknown; sdp?: unknown }
    if (typeof participantId !== 'string' || typeof sdp !== 'string' || !participantId || !sdp) return
    if (lang !== language) {
      void sendLive(sessionId, 'rtc-answer', { participantId, error: 'language_unavailable' })
      return
    }
    if (peers.size >= MAX_PEERS && !peers.has(participantId)) {
      void sendLive(sessionId, 'rtc-answer', { participantId, error: 'full' })
      return
    }
    closePeer(participantId)
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peers.set(participantId, pc)
    const [track] = phoneDestination.stream.getAudioTracks()
    pc.addTrack(track, phoneDestination.stream)
    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      void sendLive(sessionId, 'rtc-ice', { participantId, to: 'participant', candidate: event.candidate.toJSON() })
    }
    let grace = 0
    pc.onconnectionstatechange = () => {
      if (peers.get(participantId) !== pc) return
      const state = pc.connectionState
      if (state === 'connected') {
        window.clearTimeout(grace)
        grace = 0
        refreshStatus()
      } else if (state === 'disconnected') {
        // A phone changing access points or waking up; the phone side will
        // re-offer if it really is gone.
        if (!grace) grace = window.setTimeout(() => { grace = 0; if (peers.get(participantId) === pc && pc.connectionState !== 'connected') closePeer(participantId) }, DISCONNECT_GRACE_MS)
      } else if (state === 'failed' || state === 'closed') {
        closePeer(participantId)
      }
    }
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await sendLive(sessionId, 'rtc-answer', { participantId, sdp: answer.sdp })
    } catch {
      closePeer(participantId)
    }
  }

  const handleIce = async (payload: unknown) => {
    const { participantId, to, candidate } = (payload ?? {}) as { participantId?: unknown; to?: unknown; candidate?: RTCIceCandidateInit }
    if (to !== 'presenter' || typeof participantId !== 'string' || !candidate) return
    const pc = peers.get(participantId)
    if (!pc) return
    try { await pc.addIceCandidate(candidate) } catch { /* stale candidate */ }
  }

  const unsubscribes = toPhones
    ? [
        onLiveEvent(sessionId, 'rtc-offer', (payload) => { void handleOffer(payload) }),
        onLiveEvent(sessionId, 'rtc-ice', (payload) => { void handleIce(payload) }),
        onLiveEvent(sessionId, 'rtc-hello', () => announce()),
        onLiveEvent(sessionId, 'rtc-bye', (payload) => {
          const participantId = (payload as { participantId?: unknown } | undefined)?.participantId
          if (typeof participantId === 'string') closePeer(participantId)
        }),
      ]
    : []
  const heartbeat = toPhones ? window.setInterval(announce, STATE_HEARTBEAT_MS) : 0

  const teardown = () => {
    window.clearTimeout(sentenceIdle)
    window.clearInterval(resumeTimer)
    window.clearInterval(heartbeat)
    document.removeEventListener('visibilitychange', resume)
    unsubscribes.forEach((off) => off())
    for (const pc of peers.values()) pc.close()
    peers.clear()
    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    void inCtx.close()
    const current = socket
    socket = null
    if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'session.close' }))
    current?.close()
    void outCtx.close()
  }

  try {
    await connect()
  } catch (caught) {
    stopped = true
    teardown()
    setStatus({ state: 'off' })
    throw caught
  }

  return () => {
    stopped = true
    live = false
    if (toPhones) void sendLive(sessionId, 'interp-state', { on: false, language })
    teardown()
    setStatus({ state: 'off' })
  }
}
