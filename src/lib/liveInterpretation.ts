import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'

const CHUNK_DURATION_MS = 800
const AUDIO_SAMPLE_RATE = 24_000

export type InterpretationAudioBroadcaster = {
  close: () => void
}

function arrayBufferToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return window.btoa(binary)
}

function encodeMonoWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
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
  onError: (message: string) => void,
): Promise<InterpretationAudioBroadcaster> {
  const supabase = requireSupabase()
  const channel = supabase.channel(`interpretation-audio:${sessionId}:${language}`, {
    config: { broadcast: { ack: true } },
  })
  await waitForSubscription(channel)

  let closed = false
  const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
  await audioContext.resume()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const silentOutput = audioContext.createGain()
  silentOutput.gain.value = 0
  source.connect(processor)
  processor.connect(silentOutput)
  silentOutput.connect(audioContext.destination)

  const samplesPerChunk = Math.round(audioContext.sampleRate * CHUNK_DURATION_MS / 1000)
  let pendingSamples: number[] = []
  let sendQueue = Promise.resolve()

  const sendChunk = (samples: Float32Array) => {
    sendQueue = sendQueue.then(async () => {
      const payload = {
        audioBase64: arrayBufferToBase64(encodeMonoWav(samples, audioContext.sampleRate)),
        mimeType: 'audio/wav',
      }
      const result = await channel.send({ type: 'broadcast', event: 'audio', payload })
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
      void audioContext.close()
      void supabase.removeChannel(channel)
    },
  }
}
