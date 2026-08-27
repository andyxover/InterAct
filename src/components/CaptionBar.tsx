import { useEffect, useRef, useState } from 'react'
import { finalTextFor, partialTextFor } from '../lib/captionText'
import type { CaptionPartial } from '../lib/captionText'
import { subscribeLivePartials } from '../lib/livePartials'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Caption } from '../types'

const CAPTION_VISIBLE_MS = 12_000
const PARTIAL_STALE_MS = 8_000
const EMPTY_PARTIAL: CaptionPartial = { text: '' }

type Props = {
  sessionId: string
  // 'zh-TW' and 'en' localize for participants; 'overlay' shows the original
  // line plus its English rendering on the presenter's screen.
  mode: 'zh-TW' | 'en' | 'overlay'
}

type CaptionDisplay = 'zh' | 'en' | 'both'
type CaptionAppearance = { display: CaptionDisplay; size: 'sm' | 'md' | 'lg'; style: 'dark' | 'light' | 'plain' }

function storedCaptionAppearance(): CaptionAppearance {
  const display = localStorage.getItem('interact_caption_display')
  const size = localStorage.getItem('interact_caption_size')
  const style = localStorage.getItem('interact_caption_style')
  return {
    display: display === 'zh' || display === 'en' ? display : 'both',
    size: size === 'sm' || size === 'lg' ? size : 'md',
    style: style === 'light' || style === 'plain' ? style : 'dark',
  }
}

function storedParticipantSize() {
  const stored = localStorage.getItem('interact_participant_caption_size')
  return stored === 'sm' || stored === 'lg' ? stored : 'md'
}

export function CaptionBar({ sessionId, mode }: Props) {
  const [caption, setCaption] = useState<Caption | null>(null)
  // In-progress speech streamed word-by-word from the presenter (with rolling
  // translations), shown until the finalized caption row replaces it.
  const [partial, setPartial] = useState<CaptionPartial>(EMPTY_PARTIAL)
  // Presenter-chosen classroom display language, size, and style; the
  // presenter panel writes them to localStorage and this overlay window
  // follows via storage events.
  const [appearance, setAppearance] = useState<CaptionAppearance>(storedCaptionAppearance)
  // Student-chosen size on their own phone (set from the transcript panel).
  const [participantSize, setParticipantSize] = useState(storedParticipantSize)
  const { display } = appearance
  const hideTimerRef = useRef(0)
  const partialTimerRef = useRef(0)

  useEffect(() => {
    if (mode !== 'overlay') return
    const syncAppearance = () => setAppearance(storedCaptionAppearance())
    window.addEventListener('storage', syncAppearance)
    return () => window.removeEventListener('storage', syncAppearance)
  }, [mode])

  useEffect(() => {
    if (mode === 'overlay') return
    const syncSize = () => setParticipantSize(storedParticipantSize())
    window.addEventListener('interact:caption-size', syncSize)
    return () => window.removeEventListener('interact:caption-size', syncSize)
  }, [mode])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`captions:${sessionId}:${mode}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captions', filter: `session_id=eq.${sessionId}` }, (payload) => {
        setCaption(payload.new as Caption)
        // The finalized caption supersedes the lingering partial of the same
        // sentence (the presenter no longer clears it, to avoid a blank gap).
        setPartial(EMPTY_PARTIAL)
        window.clearTimeout(partialTimerRef.current)
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => setCaption(null), CAPTION_VISIBLE_MS)
      })
      .subscribe()

    const unsubscribePartials = subscribeLivePartials(sessionId, (next) => {
      setPartial(next)
      window.clearTimeout(partialTimerRef.current)
      if (next.text) partialTimerRef.current = window.setTimeout(() => setPartial(EMPTY_PARTIAL), PARTIAL_STALE_MS)
    })

    return () => {
      window.clearTimeout(hideTimerRef.current)
      window.clearTimeout(partialTimerRef.current)
      supabase.removeChannel(channel)
      unsubscribePartials()
    }
  }, [mode, sessionId])

  const overlayClasses = `caption-bar caption-bar-overlay caption-size-${appearance.size} caption-style-${appearance.style}`
  const participantClasses = `caption-bar caption-bar-participant participant-caption-${participantSize}`

  if (partial.text) {
    const partialText = mode === 'overlay'
      ? partialTextFor(partial, display === 'en' ? 'en' : 'zh', display === 'en')
      : partialTextFor(partial, mode === 'en' ? 'en' : 'zh')
    const partialSecondary = mode === 'overlay' && display === 'both'
      ? partialTextFor(partial, 'en', true)
      : ''
    if (partialText) {
      return (
        <div aria-live="polite" className={mode === 'overlay' ? overlayClasses : participantClasses}>
          <p className="caption-primary caption-live">{partialText}</p>
          {partialSecondary && partialSecondary !== partialText && (
            <p className="caption-secondary caption-live">{partialSecondary}</p>
          )}
        </div>
      )
    }
  }

  if (!caption) return null

  if (mode === 'overlay') {
    const chinese = finalTextFor(caption, 'zh')
    const english = finalTextFor(caption, 'en')
    const primary = display === 'en' ? english : chinese
    if (!primary) return null
    const secondary = display === 'both' && english && english !== primary ? english : null
    return (
      <div aria-live="polite" className={overlayClasses}>
        <p className="caption-primary">{primary}</p>
        {secondary && <p className="caption-secondary">{secondary}</p>}
      </div>
    )
  }

  const text = finalTextFor(caption, mode === 'en' ? 'en' : 'zh') || caption.original
  return (
    <div aria-live="polite" className={participantClasses}>
      <p className="caption-primary">{text}</p>
    </div>
  )
}
