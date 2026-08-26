import { recordingToWav } from './audio'
import { requireSupabase } from './supabase'

const SEGMENT_MS = 5000
const MIN_SEGMENT_MS = 900
// 16-bit PCM RMS below this is treated as silence and never uploaded.
const SILENCE_RMS_THRESHOLD = 250
const MAX_IN_FLIGHT = 2

type CaptionRecorderOptions = {
  sessionId: string
  presenterToken: string
  onError: (message: string) => void
}

function wavRms(wav: ArrayBuffer) {
  const samples = new Int16Array(wav, 44)
  if (!samples.length) return 0
  let total = 0
  for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index]
  return Math.sqrt(total / samples.length)
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('無法讀取音訊片段。'))
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export async function startCaptionRecorder({ sessionId, presenterToken, onError }: CaptionRecorderOptions) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('此環境不支援錄音，無法開啟即時字幕。')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))

  let stopped = false
  let recorder: MediaRecorder | null = null
  let segmentTimer = 0
  let inFlight = 0
  let reportedError = false

  const reportError = (message: string) => {
    if (reportedError) return
    reportedError = true
    onError(message)
  }

  const sendSegment = async (blob: Blob, durationMs: number) => {
    if (durationMs < MIN_SEGMENT_MS || inFlight >= MAX_IN_FLIGHT) return
    inFlight += 1
    try {
      const wav = await recordingToWav(blob)
      const wavBuffer = await wav.arrayBuffer()
      if (wavRms(wavBuffer) < SILENCE_RMS_THRESHOLD) return

      const { data, error } = await requireSupabase().functions.invoke('live-caption', {
        body: { sessionId, presenterToken, audioBase64: await blobToBase64(wav) },
      })
      if (error) throw error
      if (data?.message) throw new Error(data.message)
      reportedError = false
    } catch (caught) {
      reportError(caught instanceof Error ? caught.message : '字幕片段處理失敗。')
    } finally {
      inFlight -= 1
    }
  }

  const recordSegment = () => {
    if (stopped) return
    const chunks: Blob[] = []
    const startedAt = Date.now()
    const nextRecorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
    recorder = nextRecorder
    nextRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    nextRecorder.onerror = () => reportError('錄音失敗，請確認麥克風權限後重試。')
    nextRecorder.onstop = () => {
      if (chunks.length) void sendSegment(new Blob(chunks, { type: nextRecorder.mimeType }), Date.now() - startedAt)
      recordSegment()
    }
    nextRecorder.start()
    segmentTimer = window.setTimeout(() => {
      if (nextRecorder.state === 'recording') nextRecorder.stop()
    }, SEGMENT_MS)
  }

  recordSegment()

  return () => {
    stopped = true
    window.clearTimeout(segmentTimer)
    if (recorder?.state === 'recording') recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
  }
}
