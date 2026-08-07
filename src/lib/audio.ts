const TARGET_SAMPLE_RATE = 16000

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

function downsample(channel: Float32Array, sourceRate: number) {
  if (sourceRate === TARGET_SAMPLE_RATE) return channel
  const ratio = sourceRate / TARGET_SAMPLE_RATE
  const result = new Float32Array(Math.max(1, Math.floor(channel.length / ratio)))
  for (let index = 0; index < result.length; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(channel.length, Math.floor((index + 1) * ratio))
    let total = 0
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) total += channel[sourceIndex]
    result[index] = total / Math.max(1, end - start)
  }
  return result
}

export async function recordingToWav(recording: Blob) {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer())
    const mono = new Float32Array(decoded.length)
    for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
      const channel = decoded.getChannelData(channelIndex)
      for (let index = 0; index < channel.length; index += 1) mono[index] += channel[index] / decoded.numberOfChannels
    }
    const samples = downsample(mono, decoded.sampleRate)
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    writeAscii(view, 0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeAscii(view, 8, 'WAVE')
    writeAscii(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, TARGET_SAMPLE_RATE, true)
    view.setUint32(28, TARGET_SAMPLE_RATE * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeAscii(view, 36, 'data')
    view.setUint32(40, samples.length * 2, true)
    samples.forEach((sample, index) => {
      const normalized = Math.max(-1, Math.min(1, sample))
      view.setInt16(44 + index * 2, normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff, true)
    })
    return new Blob([buffer], { type: 'audio/wav' })
  } finally {
    await context.close()
  }
}
