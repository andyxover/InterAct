import { Headphones } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Caption } from '../types'

const MAX_QUEUE = 2
const MAX_CAPTION_AGE_MS = 20_000

// A short silent WAV played inside the toggle tap unlocks the audio element
// for later programmatic playback (required by mobile autoplay policies).
function silentWavUrl() {
  const samples = 800
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

type Props = {
  sessionId: string
  participantId: string
  participantToken: string
  locale: ParticipantLocale
}

export function InterpretationPlayer({ sessionId, participantId, participantToken, locale }: Props) {
  const [enabled, setEnabled] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<string[]>([])
  const playingRef = useRef(false)
  const localeRef = useRef(locale)
  localeRef.current = locale

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()

    const playNext = () => {
      const audio = audioRef.current
      const next = queueRef.current.shift()
      if (!audio || !next) {
        playingRef.current = false
        return
      }
      playingRef.current = true
      audio.src = next
      audio.onended = playNext
      audio.onerror = playNext
      void audio.play().catch(() => playNext())
    }

    const speakCaption = async (caption: Caption) => {
      const wantedLang = localeRef.current === 'en' ? 'en' : 'zh'
      // Interpretation only when the presenter spoke another language.
      if (caption.original_lang === wantedLang) return
      const text = wantedLang === 'en' ? caption.text_en : caption.text_zh
      if (!text) return
      if (Date.now() - Date.parse(caption.created_at) > MAX_CAPTION_AGE_MS) return
      try {
        const { data, error } = await supabase.functions.invoke('caption-tts', {
          body: { sessionId, participantId, participantToken, captionId: caption.id, lang: wantedLang },
        })
        if (error || typeof data?.url !== 'string') return
        queueRef.current.push(data.url)
        // A backlog means the class has moved on; keep only the newest lines.
        while (queueRef.current.length > MAX_QUEUE) queueRef.current.shift()
        if (!playingRef.current) playNext()
      } catch {
        // Skip this line; the next caption gets a fresh attempt.
      }
    }

    const channel = supabase
      .channel(`interpretation:${sessionId}:${participantId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captions', filter: `session_id=eq.${sessionId}` }, (payload) => {
        void speakCaption(payload.new as Caption)
      })
      .subscribe()

    return () => {
      queueRef.current = []
      playingRef.current = false
      const audio = audioRef.current
      if (audio) {
        audio.onended = null
        audio.onerror = null
        audio.pause()
      }
      supabase.removeChannel(channel)
    }
  }, [enabled, participantId, participantToken, sessionId])

  function toggle() {
    if (!enabled) {
      // Unlock audio playback inside the user gesture.
      if (!audioRef.current) audioRef.current = new Audio()
      const audio = audioRef.current
      const unlock = silentWavUrl()
      audio.src = unlock
      void audio.play().catch(() => null)
      window.setTimeout(() => URL.revokeObjectURL(unlock), 3000)
    }
    setEnabled((current) => !current)
  }

  return (
    <button
      aria-pressed={enabled}
      className={`interpretation-toggle${enabled ? ' is-active' : ''}`}
      title={participantText(locale, 'interpretationHint')}
      type="button"
      onClick={toggle}
    >
      <Headphones size={17} />
      <span>{participantText(locale, 'interpretation')}</span>
    </button>
  )
}
