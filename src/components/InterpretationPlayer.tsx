import { Headphones, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { subscribeLiveFinals } from '../lib/liveChannel'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Caption } from '../types'

// Lines older than this are not worth hearing: the class has moved on.
const MAX_CAPTION_AGE_MS = 20_000
// With this many lines waiting, playback speeds up to catch the speaker.
const CATCH_UP_QUEUE = 2
const CATCH_UP_RATE = 1.25
const MAX_QUEUE = 3

type QueueItem = { url: string; createdAt: number }

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

/**
 * Spoken translation for a listener whose language the presenter is not
 * speaking. Each finished caption is fetched as audio (the server usually has
 * it ready, synthesised the moment the caption was stored) and played in
 * order. Two things this used to do silently are now said: a line that the
 * browser refuses to play (autoplay lock after a lock-screen, a Bluetooth
 * switch) shows "tap to resume" on the button instead of vanishing, and a
 * backlog plays faster rather than falling ever further behind.
 */
export function InterpretationPlayer({ sessionId, participantId, participantToken, locale }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const playingRef = useRef(false)
  const localeRef = useRef(locale)
  localeRef.current = locale

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()

    const playNext = () => {
      const audio = audioRef.current
      // Skip anything that has gone stale while waiting its turn.
      while (queueRef.current.length && Date.now() - queueRef.current[0].createdAt > MAX_CAPTION_AGE_MS) queueRef.current.shift()
      const next = queueRef.current.shift()
      if (!audio || !next) {
        playingRef.current = false
        setSpeaking(false)
        return
      }
      playingRef.current = true
      setSpeaking(true)
      audio.src = next.url
      audio.playbackRate = queueRef.current.length >= CATCH_UP_QUEUE ? CATCH_UP_RATE : 1
      audio.onended = playNext
      audio.onerror = playNext
      void audio.play().then(() => setBlocked(false)).catch((caught: unknown) => {
        const name = caught instanceof Error ? caught.name : ''
        if (name === 'NotAllowedError') {
          // The browser wants a gesture again. Keep the line so the tap that
          // unlocks us plays it, and say so on the button.
          queueRef.current.unshift(next)
          playingRef.current = false
          setSpeaking(false)
          setBlocked(true)
          return
        }
        playNext()
      })
    }

    const speakCaption = async (caption: Caption) => {
      const wantedLang = localeRef.current === 'en' ? 'en' : 'zh'
      // Interpretation only when the presenter spoke another language.
      if (caption.original_lang === wantedLang) return
      const text = wantedLang === 'en' ? caption.text_en : caption.text_zh
      if (!text) return
      const createdAt = Date.parse(caption.created_at) || Date.now()
      if (Date.now() - createdAt > MAX_CAPTION_AGE_MS) return
      try {
        const { data, error } = await supabase.functions.invoke('caption-tts', {
          body: { sessionId, participantId, participantToken, captionId: caption.id, lang: wantedLang },
        })
        if (error || typeof data?.url !== 'string') return
        queueRef.current.push({ url: data.url, createdAt })
        // A backlog means the class has moved on; keep only the newest lines.
        while (queueRef.current.length > MAX_QUEUE) queueRef.current.shift()
        if (!playingRef.current) playNext()
      } catch {
        // Skip this line; the next caption gets a fresh attempt.
      }
    }

    const unsubscribe = subscribeLiveFinals(sessionId, (caption) => { void speakCaption(caption) })

    return () => {
      queueRef.current = []
      playingRef.current = false
      setSpeaking(false)
      const audio = audioRef.current
      if (audio) {
        audio.onended = null
        audio.onerror = null
        audio.pause()
      }
      unsubscribe()
    }
  }, [enabled, participantId, participantToken, sessionId])

  function unlock() {
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    const url = silentWavUrl()
    audio.src = url
    void audio.play().catch(() => null)
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  function toggle() {
    if (blocked && enabled) {
      // The tap is the gesture the browser wanted. Unlock and play what waited.
      unlock()
      setBlocked(false)
      const audio = audioRef.current
      const next = queueRef.current.shift()
      if (audio && next) {
        playingRef.current = true
        setSpeaking(true)
        audio.src = next.url
        const done = () => { playingRef.current = false; setSpeaking(false) }
        audio.onended = done
        audio.onerror = done
        void audio.play().catch(() => { playingRef.current = false; setSpeaking(false) })
      }
      return
    }
    if (!enabled) unlock()
    setBlocked(false)
    setEnabled((current) => !current)
  }

  const label = blocked
    ? participantText(locale, 'interpretationBlocked')
    : participantText(locale, 'interpretation')

  return (
    <button
      aria-pressed={enabled}
      className={`interpretation-toggle${enabled ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}${speaking ? ' is-speaking' : ''}`}
      title={participantText(locale, 'interpretationHint')}
      type="button"
      onClick={toggle}
    >
      {blocked ? <VolumeX size={17} /> : <Headphones size={17} />}
      <span>{label}</span>
    </button>
  )
}
