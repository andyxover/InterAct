import { Headphones, Radio, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { onLiveEvent, sendLive, subscribeLiveFinals } from '../lib/liveChannel'
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
// How often to ask the presenter whether a live stream is on offer.
const HELLO_MS = 6_000
// The presenter announces every 8 s; twice that with no word means it is gone.
const STATE_STALE_MS = 20_000
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

type QueueItem = { url: string; createdAt: number }

// The element that plays the live stream lives in the page, hidden: an
// element that is only held in a variable is fair game for garbage collection
// on some phones, and iOS will not play a stream through one that is not
// attached and marked inline.
function liveAudioElement() {
  const el = document.createElement('audio')
  el.setAttribute('data-interp-live', '')
  el.setAttribute('playsinline', '')
  el.hidden = true
  document.body.appendChild(el)
  return el
}

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
 * speaking. Two sources, chosen automatically:
 *
 *   live — when the presenter is broadcasting the interpreter to phones, a
 *          WebRTC audio stream straight from their laptop: continuous, about
 *          a second behind the speaker.
 *   captions — otherwise, each finished caption fetched as audio (synthesised
 *          the moment it was stored) and played in order.
 *
 * A line the browser refuses to play (autoplay lock after a lock-screen, a
 * Bluetooth switch) shows "tap to resume" on the button instead of vanishing,
 * and a caption backlog plays faster rather than falling ever further behind.
 */
export function InterpretationPlayer({ sessionId, participantId, participantToken, locale }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [liveStream, setLiveStream] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const liveAudioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const playingRef = useRef(false)
  const liveRef = useRef(false)
  const localeRef = useRef(locale)
  localeRef.current = locale

  // --- Spoken captions ------------------------------------------------------
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()

    const playNext = () => {
      const audio = audioRef.current
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
      // The live stream already carries this sentence.
      if (liveRef.current) return
      const wantedLang = localeRef.current === 'en' ? 'en' : 'zh'
      if (caption.original_lang === wantedLang) return
      const text = wantedLang === 'en' ? caption.text_en : caption.text_zh
      if (!text) return
      const createdAt = Date.parse(caption.created_at) || Date.now()
      if (Date.now() - createdAt > MAX_CAPTION_AGE_MS) return
      try {
        const { data, error } = await supabase.functions.invoke('caption-tts', {
          body: { sessionId, participantId, participantToken, captionId: caption.id, lang: wantedLang },
        })
        if (error || typeof data?.url !== 'string' || liveRef.current) return
        queueRef.current.push({ url: data.url, createdAt })
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

  // --- The live stream from the presenter -----------------------------------
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !sessionId) return
    const wantedLang = localeRef.current === 'en' ? 'en' : 'zh'
    let pc: RTCPeerConnection | null = null
    let connecting = false
    let lastStateAt = 0
    let offeredLanguage: string | null = null

    const setLive = (on: boolean) => {
      liveRef.current = on
      setLiveStream(on)
      if (on) {
        // Drop any queued caption audio: the stream is the voice now.
        queueRef.current = []
        audioRef.current?.pause()
        playingRef.current = false
        setSpeaking(false)
      }
    }

    const drop = () => {
      pc?.close()
      pc = null
      connecting = false
      const el = liveAudioRef.current
      if (el) { el.pause(); el.srcObject = null }
      if (liveRef.current) setLive(false)
    }

    const connect = async () => {
      if (pc || connecting) return
      connecting = true
      const next = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pc = next
      next.addTransceiver('audio', { direction: 'recvonly' })
      next.onicecandidate = (event) => {
        if (!event.candidate) return
        void sendLive(sessionId, 'rtc-ice', { participantId, to: 'presenter', candidate: event.candidate.toJSON() })
      }
      next.ontrack = (event) => {
        if (!liveAudioRef.current) liveAudioRef.current = liveAudioElement()
        const el = liveAudioRef.current
        el.srcObject = event.streams[0] ?? new MediaStream([event.track])
        el.autoplay = true
        void el.play().then(() => { setBlocked(false); setLive(true) }).catch((caught: unknown) => {
          const name = caught instanceof Error ? caught.name : ''
          if (name === 'NotAllowedError') setBlocked(true)
        })
      }
      next.onconnectionstatechange = () => {
        if (next !== pc) return
        if (next.connectionState === 'connected') connecting = false
        if (next.connectionState === 'failed' || next.connectionState === 'disconnected' || next.connectionState === 'closed') drop()
      }
      try {
        const offer = await next.createOffer()
        await next.setLocalDescription(offer)
        await sendLive(sessionId, 'rtc-offer', { participantId, lang: wantedLang, sdp: offer.sdp })
      } catch {
        drop()
      }
    }

    const offAnswer = onLiveEvent(sessionId, 'rtc-answer', (payload) => {
      const { participantId: target, sdp, error } = (payload ?? {}) as { participantId?: unknown; sdp?: unknown; error?: unknown }
      if (target !== participantId) return
      if (typeof error === 'string' || typeof sdp !== 'string' || !pc) { drop(); return }
      void pc.setRemoteDescription({ type: 'answer', sdp }).catch(drop)
    })
    const offIce = onLiveEvent(sessionId, 'rtc-ice', (payload) => {
      const { participantId: target, to, candidate } = (payload ?? {}) as { participantId?: unknown; to?: unknown; candidate?: RTCIceCandidateInit }
      if (to !== 'participant' || target !== participantId || !candidate || !pc) return
      void pc.addIceCandidate(candidate).catch(() => null)
    })
    const offState = onLiveEvent(sessionId, 'interp-state', (payload) => {
      const { on, language } = (payload ?? {}) as { on?: unknown; language?: unknown }
      lastStateAt = Date.now()
      offeredLanguage = on === true && typeof language === 'string' ? language : null
      if (offeredLanguage === wantedLang) void connect()
      else drop()
    })

    void sendLive(sessionId, 'rtc-hello', { participantId })
    const hello = window.setInterval(() => {
      if (!pc) void sendLive(sessionId, 'rtc-hello', { participantId })
      // The presenter has gone quiet: back to spoken captions until it returns.
      if (pc && lastStateAt && Date.now() - lastStateAt > STATE_STALE_MS) drop()
    }, HELLO_MS)

    return () => {
      window.clearInterval(hello)
      offAnswer()
      offIce()
      offState()
      void sendLive(sessionId, 'rtc-bye', { participantId })
      drop()
    }
  }, [enabled, participantId, sessionId])

  function unlock() {
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    const url = silentWavUrl()
    audio.src = url
    void audio.play().catch(() => null)
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
    if (!liveAudioRef.current) liveAudioRef.current = liveAudioElement()
  }

  function toggle() {
    if (blocked && enabled) {
      unlock()
      setBlocked(false)
      const liveEl = liveAudioRef.current
      if (liveEl?.srcObject) {
        void liveEl.play().then(() => setLive(true)).catch(() => null)
        return
      }
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

  function setLive(on: boolean) {
    liveRef.current = on
    setLiveStream(on)
  }

  const label = blocked
    ? participantText(locale, 'interpretationBlocked')
    : liveStream
      ? participantText(locale, 'interpretationLive')
      : participantText(locale, 'interpretation')

  return (
    <button
      aria-pressed={enabled}
      className={`interpretation-toggle${enabled ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}${speaking || liveStream ? ' is-speaking' : ''}${liveStream ? ' is-live' : ''}`}
      title={participantText(locale, 'interpretationHint')}
      type="button"
      onClick={toggle}
    >
      {blocked ? <VolumeX size={17} /> : liveStream ? <Radio size={17} /> : <Headphones size={17} />}
      <span>{label}</span>
    </button>
  )
}
