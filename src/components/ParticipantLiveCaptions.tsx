import { Captions } from 'lucide-react'
import { captionLanguageLabel } from '../lib/captionLanguages'
import { latestCaptionLines } from '../lib/captionDisplay'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  availableLanguages: string[]
  language: string
  text: string
  onLanguageChange: (language: string) => void
  locale?: ParticipantLocale
}

export function ParticipantLiveCaptions({ availableLanguages, language, text, onLanguageChange, locale = 'zh-TW' }: Props) {
  return (
    <section className="panel participant-live-captions" aria-live="polite">
      <div className="participant-caption-heading">
        <span><Captions size={18} />{locale === 'en' ? 'Live captions' : '即時字幕'}</span>
        {availableLanguages.length > 1 && (
          <select aria-label={locale === 'en' ? 'Caption language' : '字幕語言'} value={language} onChange={(event) => onLanguageChange(event.target.value)}>
            {availableLanguages.map((code) => <option key={code} value={code}>{captionLanguageLabel(code)}</option>)}
          </select>
        )}
      </div>
      <p>{latestCaptionLines(text, 22) || (locale === 'en' ? 'Captions are on. Waiting for the instructor...' : '字幕已開啟，等待講師說話...')}</p>
    </section>
  )
}
