import { Captions } from 'lucide-react'
import { captionLanguageLabel } from '../lib/captionLanguages'

type Props = {
  availableLanguages: string[]
  language: string
  text: string
  onLanguageChange: (language: string) => void
}

export function ParticipantLiveCaptions({ availableLanguages, language, text, onLanguageChange }: Props) {
  return (
    <section className="panel participant-live-captions" aria-live="polite">
      <div className="participant-caption-heading">
        <span><Captions size={18} />即時字幕</span>
        {availableLanguages.length > 1 && (
          <select aria-label="字幕語言" value={language} onChange={(event) => onLanguageChange(event.target.value)}>
            {availableLanguages.map((code) => <option key={code} value={code}>{captionLanguageLabel(code)}</option>)}
          </select>
        )}
      </div>
      <p>{text || '字幕已開啟，等待講師說話...'}</p>
    </section>
  )
}
