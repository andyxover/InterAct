import { requireSupabase } from './supabase'

// The live interpreter: the presenter's voice, translated as speech while
// they are still talking, played out of THIS machine.
//
// One OpenAI translation session streams microphone audio up and translated
// audio (24 kHz PCM) plus translated text back, phrase by phrase, about a
// second behind the speaker. The audio goes to an output device the presenter
// chooses — a SKAA transmitter, so every student holding a SKAA headphone
// hears the interpretation with radio latency and nothing to install — and
// not to the room's own speakers, which the microphone would hear and
// translate again.

export type InterpreterLanguage = 'en' | 'zh'

export type InterpreterStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'reconnecting'; attempt: number }
  | { state: 'silent' }
  | { state: 'error'; message: string }

export type OutputDevice = { deviceId: string; label: string }

type Options = {
  sessionId: string
  presenterToken: string
  language: InterpreterLanguage
  /** Output device id from listOutputDevices(); empty for the system default. */
  outputDeviceId?: string
  onStatus?: (status: InterpreterStatus) => void
  /** The translation so far, for a line on the presenter's screen. */
  onText?: (text: string) => void
}

const SAMPLE_RATE = 24000
const MAX_RECONNECT_ATTEMPTS = 8
// Each chunk is scheduled right after the previous one so the voice is
// continuous; after a stall, restart just ahead of now instead of piling up
// delay.
const LEAD_S = 0.05
const KEEP_TEXT_CHARS = 400
// No microphone energy for this long while live is said, not guessed at.
const SILENCE_WARN_MS = 12000
const SILENCE_RMS = 0.004

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

export async function startInterpreter({ sessionId, presenterToken, language, outputDeviceId = '', onStatus, onText }: Options) {
  const setStatus = (status: InterpreterStatus) => onStatus?.(status)
  setStatus({ state: 'connecting' })
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('此環境不支援錄音，無法開啟口譯。')

  // Output: its own context so the chosen device applies to it alone.
  const output = new AudioContext({ sampleRate: SAMPLE_RATE }) as SinkAudioContext
  if (outputDeviceId && outputDeviceId !== 'default') {
    if (typeof output.setSinkId !== 'function') {
      void output.close()
      throw new Error('這個環境無法選擇音訊輸出裝置。')
    }
    try {
      await output.setSinkId(outputDeviceId)
    } catch {
      void output.close()
      throw new Error('找不到選擇的輸出裝置，請重新整理裝置清單後再選一次。')
    }
  }

  // Input: the microphone, as 24 kHz PCM16. Echo cancellation stays on so
  // that whatever leaks from the output device into the room is not fed back.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  }).catch(() => { void output.close(); throw new Error('無法使用麥克風，請確認已允許 InterAct 錄音。') })
  const input = new AudioContext()
  const source = input.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but works everywhere without a worker,
  // which the app's CSP (script-src 'self') would block as a blob module.
  const processor = input.createScriptProcessor(4096, 1, 1)

  let stopped = false
  let socket: WebSocket | null = null
  let reconnectAttempts = 0
  let live = false
  let nextPlayAt = 0
  let text = ''
  let lastLoudAt = Date.now()
  let silentWarned = false

  processor.onaudioprocess = (event) => {
    if (stopped) return
    const samples = event.inputBuffer.getChannelData(0)
    const now = Date.now()
    if (rms(samples) > SILENCE_RMS) {
      lastLoudAt = now
      if (silentWarned && live) { silentWarned = false; setStatus({ state: 'live' }) }
    } else if (live && !silentWarned && now - lastLoudAt > SILENCE_WARN_MS) {
      silentWarned = true
      setStatus({ state: 'silent' })
    }
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({
      type: 'session.input_audio_buffer.append',
      audio: floatToPcm16Base64(downsampleTo24k(samples, input.sampleRate)),
    }))
  }
  source.connect(processor)
  processor.connect(input.destination)

  // A browser suspends an audio graph when it feels like it; a suspended
  // graph sends nothing and plays nothing. Resume both, now and on return.
  const resume = () => {
    if (input.state === 'suspended') void input.resume().catch(() => null)
    if (output.state === 'suspended') void output.resume().catch(() => null)
  }
  resume()
  document.addEventListener('visibilitychange', resume)
  const resumeTimer = window.setInterval(resume, 5000)

  const play = (base64: string) => {
    const samples = pcm16Base64ToFloat32(base64)
    if (!samples.length) return
    const buffer = output.createBuffer(1, samples.length, SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    const node = output.createBufferSource()
    node.buffer = buffer
    node.connect(output.destination)
    const startAt = Math.max(output.currentTime + LEAD_S, nextPlayAt)
    node.start(startAt)
    nextPlayAt = startAt + buffer.duration
  }

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
      setStatus({ state: 'live' })
    }
    nextSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data))
        if (data.type === 'session.output_audio.delta' && typeof data.delta === 'string') {
          play(data.delta)
        } else if (data.type === 'session.output_transcript.delta' && typeof data.delta === 'string') {
          text = (text + data.delta).slice(-KEEP_TEXT_CHARS)
          onText?.(text)
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

  const teardown = () => {
    window.clearInterval(resumeTimer)
    document.removeEventListener('visibilitychange', resume)
    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    void input.close()
    const current = socket
    socket = null
    if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'session.close' }))
    current?.close()
    void output.close()
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
    teardown()
    setStatus({ state: 'off' })
  }
}
