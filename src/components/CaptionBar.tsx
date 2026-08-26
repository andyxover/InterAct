import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Caption } from '../types'

const CAPTION_VISIBLE_MS = 12_000

type Props = {
  sessionId: string
  // 'zh-TW' and 'en' localize for participants; 'overlay' shows the original
  // line plus its English rendering on the presenter's screen.
  mode: 'zh-TW' | 'en' | 'overlay'
}

export function CaptionBar({ sessionId, mode }: Props) {
  const [caption, setCaption] = useState<Caption | null>(null)
  const hideTimerRef = useRef(0)

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

    return () => {
      window.clearTimeout(hideTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [mode, sessionId])

  if (!caption) return null

  if (mode === 'overlay') {
    // Transcription may come back in simplified characters; prefer the
    // Traditional Chinese rendering on the classroom screen.
    const primary = (caption.original_lang === 'zh' && caption.text_zh) || caption.original
    const secondary = caption.text_en && caption.text_en !== primary ? caption.text_en : null
    return (
      <div aria-live="polite" className="caption-bar caption-bar-overlay">
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
