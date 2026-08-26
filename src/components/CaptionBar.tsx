import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Caption } from '../types'

const CAPTION_VISIBLE_MS = 12_000
const PARTIAL_STALE_MS = 8_000

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

export function CaptionBar({ sessionId, mode }: Props) {
  const [caption, setCaption] = useState<Caption | null>(null)
  // In-progress speech streamed word-by-word from the presenter, shown until
  // the finalized (and translated) caption row replaces it.
  const [partial, setPartial] = useState('')
  // Presenter-chosen classroom display language, size, and style; the
  // presenter panel writes them to localStorage and this overlay window
  // follows via storage events.
  const [appearance, setAppearance] = useState<CaptionAppearance>(storedCaptionAppearance)
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
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`captions:${sessionId}:${mode}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captions', filter: `session_id=eq.${sessionId}` }, (payload) => {
        setCaption(payload.new as Caption)
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => setCaption(null), CAPTION_VISIBLE_MS)
      })
      .subscribe()

    const liveChannel = supabase
      .channel(`caption-live:${sessionId}`)
      .on('broadcast', { event: 'partial' }, (message) => {
        const text = typeof message.payload?.text === 'string' ? message.payload.text : ''
        setPartial(text)
        window.clearTimeout(partialTimerRef.current)
        if (text) partialTimerRef.current = window.setTimeout(() => setPartial(''), PARTIAL_STALE_MS)
      })
      .subscribe()

    return () => {
      window.clearTimeout(hideTimerRef.current)
      window.clearTimeout(partialTimerRef.current)
      supabase.removeChannel(channel)
      supabase.removeChannel(liveChannel)
    }
  }, [mode, sessionId])

  const overlayClasses = `caption-bar caption-bar-overlay caption-size-${appearance.size} caption-style-${appearance.style}`

  // In English-only classroom display, live partials (which arrive in the
  // spoken language) are hidden; sentences appear once translated.
  const partialsVisible = mode !== 'overlay' || display !== 'en'
  if (partial && partialsVisible) {
    return (
      <div aria-live="polite" className={mode === 'overlay' ? overlayClasses : 'caption-bar caption-bar-participant'}>
        <p className="caption-primary caption-live">{partial}</p>
      </div>
    )
  }

  if (!caption) return null

  if (mode === 'overlay') {
    // Transcription may come back in simplified characters; prefer the
    // Traditional Chinese rendering on the classroom screen.
    const chinese = (caption.original_lang === 'zh' && caption.text_zh) || caption.text_zh || caption.original
    const english = caption.text_en || (caption.original_lang === 'en' ? caption.original : null)
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

  const text = mode === 'en'
    ? caption.text_en || caption.original
    : caption.text_zh || caption.original
  return (
    <div aria-live="polite" className="caption-bar caption-bar-participant">
      <p className="caption-primary">{text}</p>
    </div>
  )
}
