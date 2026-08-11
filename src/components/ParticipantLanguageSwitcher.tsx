import { Check, Globe2 } from 'lucide-react'
import { useState } from 'react'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  locale: ParticipantLocale
  onChange: (locale: ParticipantLocale) => void
}

export function ParticipantLanguageSwitcher({ locale, onChange }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="participant-language-switcher">
      {open && (
        <div className="participant-language-menu" role="menu">
          {(['zh-TW', 'en'] as const).map((code) => (
            <button key={code} role="menuitemradio" aria-checked={locale === code} type="button" onClick={() => { onChange(code); setOpen(false) }}>
              <span>{code === 'en' ? participantText(locale, 'english') : participantText(locale, 'chinese')}</span>
              {locale === code && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
      <button
        aria-expanded={open}
        aria-label={participantText(locale, 'language')}
        className="participant-language-button"
        title={participantText(locale, 'language')}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Globe2 size={22} /><span>{locale === 'en' ? 'EN' : '中'}</span>
      </button>
    </div>
  )
}
