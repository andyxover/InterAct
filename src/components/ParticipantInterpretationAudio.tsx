import { Headphones, Pause, Play, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { captionLanguageLabel } from '../lib/captionLanguages'
import { requireSupabase } from '../lib/supabase'

type Props = {
  enabled: boolean
  languages: string[]
  sessionId: string
}

function extractArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
  if (value && typeof value === 'object' && 'payload' in value) {
    return extractArrayBuffer((value as { payload: unknown }).payload)
  }
  if (value && typeof value === 'object' && 'audioBase64' in value) {
    const encoded = (value as { audioBase64?: unknown }).audioBase64
    if (typeof encoded !== 'string' || !encoded) return null
    try {
      const binary = window.atob(encoded)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return bytes.buffer
    } catch {
      return null
    }
  }
  return null
}

export function ParticipantInterpretationAudio({ enabled, languages, sessionId }: Props) {
  const [language, setLanguage] = useState(() => localStorage.getItem(`interact_interpretation_language_${sessionId}`) || languages[0] || '')
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const nextPlaybackAtRef = useRef(0)

  useEffect(() => {
    if (!languages.includes(language)) setLanguage(languages[0] || '')
  }, [language, languages])

  useEffect(() => {
    if (!enabled) setListening(false)
  }, [enabled])

  useEffect(() => {
    if (!listening || !enabled || !language) return
    const supabase = requireSupabase()
    const context = audioContextRef.current || new AudioContext()
    audioContextRef.current = context
    nextPlaybackAtRef.current = context.currentTime
    setStatus('正在連接教師端口譯...')

    const channel = supabase
      .channel(`interpretation-audio:${sessionId}:${language}`)
      .on('broadcast', { event: 'audio' }, (message) => {
        const bytes = extractArrayBuffer(message)
        if (!bytes) return
        void context.decodeAudioData(bytes.slice(0)).then(async (buffer) => {
          if (context.state !== 'running') await context.resume()
          if (context.state !== 'running') throw new Error('AudioContext is suspended')
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(context.destination)
          const lag = nextPlaybackAtRef.current - context.currentTime
          if (lag > 5 || lag < -0.5) nextPlaybackAtRef.current = context.currentTime + 0.08
          const startsAt = Math.max(context.currentTime + 0.04, nextPlaybackAtRef.current)
          source.start(startsAt)
          nextPlaybackAtRef.current = startsAt + buffer.duration
          setStatus('口譯播放中')
        }).catch(() => setStatus('收到音訊，但播放失敗；請按「停止聆聽」後重新開始。'))
      })
      .subscribe((nextStatus) => {
        if (nextStatus === 'SUBSCRIBED') setStatus('已連線，等待教師說話...')
        if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT') setStatus('口譯連線失敗，請重試。')
      })

    return () => {
      void supabase.removeChannel(channel)
      nextPlaybackAtRef.current = 0
    }
  }, [enabled, language, listening, sessionId])

  useEffect(() => () => {
    void audioContextRef.current?.close()
  }, [])

  async function toggleListening() {
    if (listening) {
      setListening(false)
      setStatus('')
      return
    }
    const context = audioContextRef.current || new AudioContext()
    audioContextRef.current = context
    await context.resume()
    setListening(true)
  }

  if (!enabled || !languages.length) return null

  return (
    <section className="panel participant-interpretation-audio">
      <div className="participant-interpretation-heading">
        <span><Headphones size={19} />即時語音口譯</span>
        {listening && <Volume2 className="interpretation-playing-icon" size={18} />}
      </div>
      <label>
        耳機語言
        {languages.length > 2 ? (
          <select disabled={listening} value={language} onChange={(event) => {
            setLanguage(event.target.value)
            localStorage.setItem(`interact_interpretation_language_${sessionId}`, event.target.value)
          }}>
            {languages.map((code) => <option key={code} value={code}>{captionLanguageLabel(code)}</option>)}
          </select>
        ) : (
          <span className="interpretation-language-buttons">
            {languages.map((code) => (
              <button
                aria-pressed={language === code}
                className={language === code ? 'is-active' : 'ghost-button'}
                disabled={listening}
                key={code}
                type="button"
                onClick={() => {
                  setLanguage(code)
                  localStorage.setItem(`interact_interpretation_language_${sessionId}`, code)
                }}
              >
                {captionLanguageLabel(code)}
              </button>
            ))}
          </span>
        )}
      </label>
      <button className={listening ? 'ghost-button' : ''} type="button" onClick={() => void toggleListening()}>
        {listening ? <><Pause size={17} />停止聆聽</> : <><Play size={17} />開始聆聽口譯</>}
      </button>
      <p className="muted">{status || '建議戴上耳機，選擇語言後開始聆聽。'}</p>
    </section>
  )
}
