import { useEffect, useRef, useState } from 'react'

export type MeterActivity = 'hearing' | 'transcribing' | 'translating' | 'speaking'

const ACTIVITY_LABEL: Record<MeterActivity, string> = {
  hearing: '收到聲音',
  transcribing: '辨識中',
  translating: '翻譯中',
  speaking: '播放中',
}
// An activity lights its label for this long after the last report.
const ACTIVITY_HOLD_MS = 1200
const BARS = 14

type Props = {
  /** Microphone level, 0–1. */
  level: number
  /** The latest thing the pipeline did, with when it did it. */
  activity: { kind: MeterActivity; at: number } | null
  /** Which stage labels apply here (captions do not speak; the interpreter does not transcribe). */
  stages: MeterActivity[]
}

/**
 * Proof that the microphone is heard and the pipeline is moving: a level
 * meter that follows the voice, and a label for the stage that just fired.
 * The bars are drawn from the level a few times a second and eased down,
 * so a pause reads as the meter settling rather than snapping to nothing.
 */
export function MicMeter({ level, activity, stages }: Props) {
  const [shown, setShown] = useState(0)
  const target = useRef(0)
  target.current = level
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(100, t - last)
      last = t
      setShown((cur) => {
        const goal = target.current
        // Up fast, down slow.
        const rate = goal > cur ? 0.02 : 0.006
        const next = cur + (goal - cur) * Math.min(1, rate * dt)
        return Math.abs(next - goal) < 0.002 ? goal : next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const clock = window.setInterval(() => setNow(Date.now()), 300)
    return () => { cancelAnimationFrame(frame); window.clearInterval(clock) }
  }, [])

  const lit = Math.round(shown * BARS)
  const active = activity && now - activity.at < ACTIVITY_HOLD_MS ? activity.kind : null

  return (
    <div className="mic-meter" role="img" aria-label={`麥克風音量 ${Math.round(shown * 100)}%${active ? `，${ACTIVITY_LABEL[active]}` : ''}`}>
      <div className={`mic-meter-bars${shown > 0.04 ? ' is-hearing' : ''}`} aria-hidden="true">
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} className={i < lit ? 'on' : ''} style={{ height: `${28 + (i % 3) * 14 + (i >= BARS - 3 ? 16 : 0)}%` }} />
        ))}
      </div>
      <div className="mic-meter-stages" aria-hidden="true">
        {stages.map((stage) => (
          <span key={stage} className={`mic-meter-stage${active === stage ? ' is-active' : ''}`}>{ACTIVITY_LABEL[stage]}</span>
        ))}
      </div>
    </div>
  )
}
