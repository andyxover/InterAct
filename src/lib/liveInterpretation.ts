import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'

const CHUNK_DURATION_MS = 250
const AUDIO_PACKET_HEADER_BYTES = 8

export type InterpretationAudioBroadcaster = {
  close: () => void
}

function encodePcm16(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(AUDIO_PACKET_HEADER_BYTES + samples.length * 2)
  const view = new DataView(buffer)
  // IAP1 (InterAct Audio Packet v1), followed by the little-endian sample rate.
  view.setUint8(0, 0x49)
  view.setUint8(1, 0x41)
  view.setUint8(2, 0x50)
  view.setUint8(3, 0x31)
  view.setUint32(4, sampleRate, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(AUDIO_PACKET_HEADER_BYTES + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
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
  audioContext: AudioContext,
  onError: (message: string) => void,
): Promise<InterpretationAudioBroadcaster> {
  const supabase = requireSupabase()
  const channel = supabase.channel(`interpretation-audio:${sessionId}:${language}`, {
    config: { broadcast: { ack: true } },
  })
  try {
    await waitForSubscription(channel)
  } catch (error) {
    void supabase.removeChannel(channel)
    throw error
  }

  let closed = false
  if (audioContext.state !== 'running') await audioContext.resume()
  if (audioContext.state !== 'running') {
    void supabase.removeChannel(channel)
    throw new Error('教師端的音訊處理尚未啟動，請關閉後重新開啟課程錄製。')
  }
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const silentOutput = audioContext.createGain()
  // Keep Chromium's audio graph active without making the interpreted track audible locally.
  silentOutput.gain.value = 0.000001
  source.connect(processor)
  processor.connect(silentOutput)
  silentOutput.connect(audioContext.destination)

  const samplesPerChunk = Math.round(audioContext.sampleRate * CHUNK_DURATION_MS / 1000)
  let pendingSamples: number[] = []
  let sendQueue = Promise.resolve()

  const sendChunk = (samples: Float32Array) => {
    sendQueue = sendQueue.then(async () => {
      const result = await channel.send({
        type: 'broadcast',
        event: 'audio',
        payload: encodePcm16(samples, audioContext.sampleRate),
      })
      if (result !== 'ok') throw new Error('即時口譯音訊送出失敗。')
    }).catch((error: unknown) => onError(error instanceof Error ? error.message : '即時口譯音訊送出失敗。'))
  }

  processor.addEventListener('audioprocess', (event) => {
    if (closed || !stream.active) return
    const input = event.inputBuffer
    const channels = Array.from({ length: input.numberOfChannels }, (_, index) => input.getChannelData(index))
    for (let sampleIndex = 0; sampleIndex < input.length; sampleIndex += 1) {
      let mixed = 0
      for (const channelSamples of channels) mixed += channelSamples[sampleIndex]
      pendingSamples.push(mixed / channels.length)
    }
    while (pendingSamples.length >= samplesPerChunk) {
      sendChunk(Float32Array.from(pendingSamples.splice(0, samplesPerChunk)))
    }
  })

  return {
    close() {
      if (closed) return
      closed = true
      pendingSamples = []
      source.disconnect()
      processor.disconnect()
      silentOutput.disconnect()
      void supabase.removeChannel(channel)
    },
  }
}
