import { ScrollText, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { finalTextFor, partialTextFor } from '../lib/captionText'
import type { CaptionPartial } from '../lib/captionText'
import { subscribeLivePartials } from '../lib/livePartials'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Caption } from '../types'

const HISTORY_LIMIT = 100
const EMPTY_PARTIAL: CaptionPartial = { text: '' }

type FontSize = 'sm' | 'md' | 'lg'

const SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: 'sm', label: 'A-' },
  { value: 'md', label: 'A' },
  { value: 'lg', label: 'A+' },
]

function storedSize(): FontSize {
  const stored = localStorage.getItem('interact_participant_caption_size')
  return stored === 'sm' || stored === 'lg' ? stored : 'md'
}

type Props = {
  sessionId: string
  locale: ParticipantLocale
}

export function TranscriptPanel({ sessionId, locale }: Props) {
  const [open, setOpen] = useState(false)
  const [captions, setCaptions] = useState<Caption[]>([])
  const [partial, setPartial] = useState<CaptionPartial>(EMPTY_PARTIAL)
  const [size, setSize] = useState<FontSize>(storedSize)
  const listRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const target = locale === 'en' ? 'en' : 'zh'

  function changeSize(next: FontSize) {
    setSize(next)
    localStorage.setItem('interact_participant_caption_size', next)
    // Same-window localStorage writes don't fire storage events; tell the
    // caption bar directly.
    window.dispatchEvent(new Event('interact:caption-size'))
  }

  useEffect(() => {
    if (!open || !isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    let cancelled = false

    void supabase
      .from('captions')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data }) => {
        if (!cancelled && data) setCaptions([...(data as Caption[])].reverse())
      })

    const channel = supabase
      .channel(`transcript:${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captions', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const next = payload.new as Caption
        setCaptions((current) => (current.some((item) => item.id === next.id) ? current : [...current.slice(-HISTORY_LIMIT + 1), next]))
        // The finalized line replaces the in-progress partial of that sentence.
        setPartial(EMPTY_PARTIAL)
      })
      .subscribe()

    const unsubscribePartials = subscribeLivePartials(sessionId, setPartial)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      unsubscribePartials()
    }
  }, [open, sessionId])

  useEffect(() => {
    const list = listRef.current
    if (!list || !pinnedToBottomRef.current) return
    list.scrollTop = list.scrollHeight
  }, [captions, partial, open])

  if (!open) {
    return (
      <button
        className="transcript-toggle"
        title={participantText(locale, 'transcriptTitle')}
        type="button"
        onClick={() => setOpen(true)}
      >
        <ScrollText size={17} />
        <span>{participantText(locale, 'transcriptTitle')}</span>
      </button>
    )
  }

  const partialLine = partial.text ? partialTextFor(partial, target) : ''

  return (
    <section aria-label={participantText(locale, 'transcriptTitle')} className="transcript-panel">
      <header className="transcript-header">
        <span className="transcript-title"><ScrollText size={16} />{participantText(locale, 'transcriptTitle')}</span>
        <span className="transcript-sizes" role="radiogroup" aria-label="Font size">
          {SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              aria-checked={size === option.value}
              className={`transcript-size-option${size === option.value ? ' is-active' : ''}`}
              role="radio"
              type="button"
              onClick={() => changeSize(option.value)}
            >
              {option.label}
            </button>
          ))}
        </span>
        <button aria-label={participantText(locale, 'closeLabel')} className="transcript-close" type="button" onClick={() => setOpen(false)}>
          <X size={17} />
        </button>
      </header>
      <div
        ref={listRef}
        className={`transcript-list transcript-size-${size}`}
        onScroll={(event) => {
          const list = event.currentTarget
          pinnedToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60
        }}
      >
        {captions.length === 0 && !partialLine && (
          <p className="transcript-empty">{participantText(locale, 'transcriptEmpty')}</p>
        )}
        {captions.map((caption) => {
          const text = finalTextFor(caption, target) || caption.original
          return text ? <p key={caption.id} className="transcript-line">{text}</p> : null
        })}
        {partialLine && <p className="transcript-line transcript-partial">{partialLine}</p>}
      </div>
    </section>
  )
}
