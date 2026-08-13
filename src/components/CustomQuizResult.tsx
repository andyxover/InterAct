import { BrainCircuit, Clock3 } from 'lucide-react'
import type { PresenterQuizResults, Question } from '../types'

type Props = {
  anonymousEnabled: boolean
  question: Question
  results: PresenterQuizResults | null
  onlineCount: number
}

export function CustomQuizResult({ anonymousEnabled, question, results, onlineCount }: Props) {
  if (!results) {
    return <section className="panel result-panel"><p className="muted">正在載入自訂測驗...</p></section>
  }
  const graded = results.attempts.filter((attempt) => attempt.status === 'graded')
  const grading = results.attempts.filter((attempt) => attempt.status === 'grading')
  const average = graded.length
    ? graded.reduce((sum, attempt) => sum + (attempt.total_score || 0), 0) / graded.length
    : null

  return (
    <section className="panel result-panel custom-quiz-result">
      <div className="result-heading">
        <div><p className="eyebrow"><BrainCircuit size={17} />自訂測驗</p><h2>{results.quiz.title || question.title}</h2></div>
        <span>{results.attempts.length}/{onlineCount} 人作答</span>
      </div>
      <div className="quiz-result-stats">
        <div><strong>{results.items.length}</strong><span>題</span></div>
        <div><strong>{average === null ? '—' : average.toFixed(1)}</strong><span>平均分數</span></div>
        <div><strong>{grading.length}</strong><span>評分中</span></div>
      </div>
      {grading.length > 0 && <p className="quiz-grading-note"><Clock3 size={16} />AI 正在背景評分，完成後會自動更新。</p>}
      <div className="quiz-attempt-list">
        {results.attempts.map((attempt, index) => (
          <article key={attempt.id}>
            <div><strong>{anonymousEnabled ? `匿名學員 ${index + 1}` : attempt.participant_name}</strong><span>{attempt.status === 'graded' ? `${attempt.total_score}/${attempt.max_score}` : attempt.status === 'failed' ? '評分失敗' : '評分中'}</span></div>
            {attempt.feedback?.zh_tw && <p>{attempt.feedback.zh_tw}</p>}
          </article>
        ))}
        {!results.attempts.length && <p className="muted">尚無學員送出測驗。</p>}
      </div>
    </section>
  )
}
