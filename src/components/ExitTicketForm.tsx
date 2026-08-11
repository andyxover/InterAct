import { Send, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ExitTicket, ExitTicketCategory } from '../types'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  prompt: string
  category: ExitTicketCategory
  ticket: ExitTicket | null
  busy: boolean
  onSubmit: (value: { responseText: string; rating: number }) => void
  locale?: ParticipantLocale
}

const categoryLabels: Record<ExitTicketCategory, string> = {
  lesson_summary: '課程總結',
  learning_assessment: '學習程度評估',
  course_satisfaction: '課程回饋',
  student_question: '提出疑問',
}

export function ExitTicketForm({ prompt, category, ticket, busy, onSubmit, locale = 'zh-TW' }: Props) {
  const [responseText, setResponseText] = useState('')
  const [rating, setRating] = useState(0)

  useEffect(() => {
    setResponseText('')
    setRating(0)
  }, [prompt])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (rating) onSubmit({ responseText: responseText.trim(), rating })
  }

  return (
    <section className="panel exit-ticket-panel">
      <div className="exit-ticket-heading">
        <h2>Exit Ticket</h2>
        <span>{locale === 'en' ? ({ lesson_summary: 'Lesson summary', learning_assessment: 'Learning assessment', course_satisfaction: 'Class feedback', student_question: 'Student question' } as const)[category] : categoryLabels[category]}</span>
      </div>
      {ticket ? (
        <div className="exit-ticket-submitted">
          <p className="success">{participantText(locale, 'exitSubmitted')}</p>
          <p><strong>{participantText(locale, 'learningLevel')}</strong>{ticket.rating} {participantText(locale, 'stars')}</p>
          <p><strong>{prompt}</strong></p>
          <p>{ticket.response_text}</p>
        </div>
      ) : (
        <form className="exit-ticket-form" onSubmit={submit}>
          <fieldset className="exit-ticket-question">
            <legend><span>{participantText(locale, 'required')}</span>{participantText(locale, 'ratingPrompt')}</legend>
            <div className="star-rating" role="radiogroup" aria-label={participantText(locale, 'ratingLabel')}>
              {[1, 2, 3, 4, 5].map((value) => (
              <button
                aria-checked={rating === value}
                aria-label={`${value} ${participantText(locale, 'stars')}`}
                className={value <= rating ? 'selected' : ''}
                key={value}
                role="radio"
                type="button"
                onClick={() => setRating(value)}
              >
                <Star fill={value <= rating ? 'currentColor' : 'none'} size={32} />
              </button>
              ))}
            </div>
          </fieldset>
          <label className="exit-ticket-question">
            <span className="exit-ticket-question-title"><b>{participantText(locale, 'optional')}</b>{prompt}</span>
            <textarea
              maxLength={2000}
              value={responseText}
              placeholder={participantText(locale, 'optionalPlaceholder')}
              onChange={(event) => setResponseText(event.target.value)}
            />
          </label>
          <button disabled={busy || !rating} type="submit">
            {!busy && <Send size={18} />}
            {busy ? participantText(locale, 'sending') : participantText(locale, 'submitExit')}
          </button>
        </form>
      )}
    </section>
  )
}
