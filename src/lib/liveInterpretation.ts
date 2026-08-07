import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'

const CHUNK_DURATION_MS = 1500
const AUDIO_BITS_PER_SECOND = 32_000

export type InterpretationAudioBroadcaster = {
  close: () => void
}

function supportedAudioType() {
  return ['audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function arrayBufferToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return window.btoa(binary)
}

function waitForSubscription(channel: RealtimeChannel) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('即時口譯廣播連線逾時。')), 8000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timeout)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        window.clearTimeout(timeout)
        reject(new Error('無法連接即時口譯廣播。'))
      }
    })
  })
}

export async function createInterpretationAudioBroadcaster(
  sessionId: string,
  language: string,
  stream: MediaStream,
  onError: (message: string) => void,
): Promise<InterpretationAudioBroadcaster> {
  if (typeof MediaRecorder === 'undefined') throw new Error('這個裝置不支援即時語音口譯廣播。')
  const mimeType = supportedAudioType()
  if (!mimeType) throw new Error('這個裝置無法編碼即時語音口譯。')

  const supabase = requireSupabase()
  const channel = supabase.channel(`interpretation-audio:${sessionId}:${language}`, {
    config: { broadcast: { ack: true } },
  })
  await waitForSubscription(channel)

  let closed = false
  let recorder: MediaRecorder | null = null
  let stopTimer = 0
  let sendQueue = Promise.resolve()

  const recordNextChunk = () => {
    if (closed || !stream.active) return
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
    recorder.addEventListener('dataavailable', ({ data }) => {
      if (closed || !data.size) return
      sendQueue = sendQueue.then(async () => {
        const payload = {
          audioBase64: arrayBufferToBase64(await data.arrayBuffer()),
          mimeType: data.type || mimeType,
        }
        const result = await channel.send({ type: 'broadcast', event: 'audio', payload })
        if (result !== 'ok') throw new Error('即時口譯音訊送出失敗。')
      }).catch((error: unknown) => onError(error instanceof Error ? error.message : '即時口譯音訊送出失敗。'))
    })
    recorder.addEventListener('stop', () => {
      recorder = null
      recordNextChunk()
    }, { once: true })
    recorder.start()
    stopTimer = window.setTimeout(() => {
      if (recorder?.state === 'recording') recorder.stop()
    }, CHUNK_DURATION_MS)
  }
  recordNextChunk()

  return {
    close() {
      if (closed) return
      closed = true
      window.clearTimeout(stopTimer)
      if (recorder?.state === 'recording') recorder.stop()
      void supabase.removeChannel(channel)
    },
  }
}
