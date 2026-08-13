import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, Clock3, RefreshCw, Send } from 'lucide-react'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { ParticipantQuizData } from '../types'

export type QuizSubmission = Array<{ itemId: string; answerText?: string; answerValues?: string[] }>

type Props = {
  data: ParticipantQuizData
  busy: boolean
  locale: ParticipantLocale
  onRetry: () => Promise<void>
  onSubmit: (answers: QuizSubmission) => Promise<void>
}

export function ParticipantCustomQuiz({ data, busy, locale, onRetry, onSubmit }: Props) {
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({})
  const [choiceAnswers, setChoiceAnswers] = useState<Record<string, string>>({})
  const english = locale === 'en'
  const usesAiGrading = data.items.some((item) => item.type !== 'multiple_choice')

  useEffect(() => {
    setTextAnswers({})
    setChoiceAnswers({})
  }, [data.quiz.id])

  const complete = useMemo(() => data.items.every((item) => item.type === 'multiple_choice'
    ? Boolean(choiceAnswers[item.id])
    : Boolean(textAnswers[item.id]?.trim())), [choiceAnswers, data.items, textAnswers])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!complete || busy) return
    await onSubmit(data.items.map((item) => item.type === 'multiple_choice'
      ? { itemId: item.id, answerValues: [choiceAnswers[item.id]] }
      : { itemId: item.id, answerText: textAnswers[item.id].trim() }))
  }

  if (data.attempt) {
    const graded = data.attempt.status === 'graded'
    const failed = data.attempt.status === 'failed'
    return (
      <section className="panel participant-question participant-custom-quiz">
        <div className="quiz-status-heading">
          {graded ? <CheckCircle2 size={24} /> : failed ? <RefreshCw size={24} /> : <Clock3 size={24} />}
          <div>
            <h2>{data.quiz.title}</h2>
            <p>{graded ? (english ? 'Grading completed' : '評分完成') : failed ? (english ? 'Grading was interrupted' : '評分暫時失敗') : usesAiGrading ? (english ? 'Submitted. AI is grading in the background…' : '已送出，AI 正在背景評分…') : (english ? 'Submitted. Calculating the score…' : '已送出，正在計算分數…')}</p>
          </div>
          {graded && <strong className="quiz-total-score">{data.attempt.total_score}/{data.attempt.max_score}</strong>}
        </div>
        {data.attempt.feedback && <p className="quiz-overall-feedback">{english ? data.attempt.feedback.en || data.attempt.feedback.zh_tw : data.attempt.feedback.zh_tw}</p>}
        {graded && data.items.map((item, index) => {
          const response = data.answers.find((answer) => answer.item_id === item.id)
          const translation = english ? item.translations?.en : undefined
          return (
            <article className="quiz-graded-item" key={item.id}>
              <div><strong>{index + 1}. {translation?.prompt_text || item.prompt_text}</strong><span>{response?.score ?? 0}/{item.points}</span></div>
              <p>{english ? response?.feedback?.en || response?.feedback?.zh_tw : response?.feedback?.zh_tw}</p>
            </article>
          )
        })}
        {failed && <button disabled={busy} type="button" onClick={() => void onRetry()}><RefreshCw size={18} />{english ? 'Retry grading' : '重新評分'}</button>}
      </section>
    )
  }

  return (
    <section className="panel participant-question participant-custom-quiz">
      <h2>{data.quiz.title}</h2>
      <p className="muted">{usesAiGrading
        ? (english ? 'Answer every question, then submit once. AI will grade written answers and provide feedback.' : '請完成所有題目後一次送出；填充與簡答題會由 AI 評分並提供回饋。')
        : (english ? 'Answer every question, then submit once. Multiple-choice questions are scored immediately from the answer key without AI.' : '請完成所有題目後一次送出；選擇題會直接依答案計分，不會呼叫 AI 評分。')}</p>
      <form className="custom-quiz-form" onSubmit={submit}>
        {data.items.map((item, index) => {
          const translation = english ? item.translations?.en : undefined
          const options = translation?.options?.length === item.options.length ? translation.options : item.options
          return (
            <fieldset className="custom-quiz-item" key={item.id}>
              <legend><span>{index + 1}</span>{translation?.prompt_text || item.prompt_text}<small>{item.points} {english ? 'pts' : '分'}</small></legend>
              {item.type === 'multiple_choice' ? (
                <div className="quiz-choice-list">
                  {item.options.map((option, optionIndex) => (
                    <label className={choiceAnswers[item.id] === option ? 'selected' : ''} key={option}>
                      <input checked={choiceAnswers[item.id] === option} name={item.id} type="radio" value={option} onChange={() => setChoiceAnswers((current) => ({ ...current, [item.id]: option }))} />
                      <span>{options[optionIndex]}</span>
                    </label>
                  ))}
                </div>
              ) : item.type === 'fill_blank' ? (
                <input value={textAnswers[item.id] || ''} onChange={(event) => setTextAnswers((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={english ? 'Enter your answer' : '請輸入答案'} />
              ) : (
                <textarea maxLength={4000} value={textAnswers[item.id] || ''} onChange={(event) => setTextAnswers((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={english ? 'Write your answer' : '請輸入簡答內容'} />
              )}
            </fieldset>
          )
        })}
        <button disabled={!complete || busy} type="submit"><Send size={18} />{busy ? (english ? 'Submitting…' : '送出中…') : (english ? 'Submit answers' : '送出答案')}</button>
      </form>
    </section>
  )
}
