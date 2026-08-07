import { Captions } from 'lucide-react'
import { captionLanguageLabel } from '../lib/captionLanguages'

type Props = {
  language: string
  text: string
  status?: 'idle' | 'starting' | 'live' | 'error'
}

export function LiveCaptionOverlay({ language, text, status = 'live' }: Props) {
  if (!text && status !== 'starting') return null
  return (
    <div className="live-caption-overlay" aria-live="polite">
      <span className="live-caption-language"><Captions size={16} />{captionLanguageLabel(language)}</span>
      <p>{text || '正在連接麥克風...'}</p>
    </div>
  )
}
