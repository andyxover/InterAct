import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, UserRound } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'
import { StudentSocialLinks } from '../components/StudentSocialLinks'
import { ParticipantLanguageSwitcher } from '../components/ParticipantLanguageSwitcher'
import { getDeviceId } from '../lib/device'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { participantLocaleFromStorage } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Participant, Session } from '../types'

export function JoinPage() {
  const { sessionId: sessionReference = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [locale, setLocale] = useState<ParticipantLocale>(participantLocaleFromStorage)
  const navigate = useNavigate()

  function changeLocale(nextLocale: ParticipantLocale) {
    localStorage.setItem('interact_participant_locale', nextLocale)
    setLocale(nextLocale)
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionReference) return

    const isSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionReference)
    requireSupabase()
      .from('sessions')
      .select('*')
      .eq(isSessionId ? 'id' : 'code', sessionReference)
      .single()
      .then(({ data }) => setSession(data as Session | null))
  }, [sessionReference])

  async function join(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(locale === 'en' ? 'Name is required.' : '姓名必填。')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (!session) throw new Error(locale === 'en' ? 'Session not found.' : '找不到這個場次。')
      if (session.status !== 'active') throw new Error(locale === 'en' ? 'This class has ended and can no longer be joined.' : '這堂課已經結束，無法再加入。')
      const supabase = requireSupabase()
      const deviceId = getDeviceId()
      const { data, error: joinError } = await supabase.functions.invoke('participant-action', {
        body: { action: 'join_session', sessionReference, name: trimmed, deviceId },
      })
      if (joinError) throw joinError
      if (!data?.participant || !data?.participantToken) throw new Error(data?.message || '加入失敗。')
      const participant = data.participant as Participant
      const sessionId = participant.session_id

      localStorage.setItem(`interact_participant_${sessionId}`, participant.id)
      localStorage.setItem(`interact_participant_token_${sessionId}`, data.participantToken)
      localStorage.setItem(`interact_name_${sessionId}`, participant.name)
      navigate(`/participant/${sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失敗')
    } finally {
      setBusy(false)
    }
  }

  if (session?.status === 'ended') {
    return (
      <main className="center-page">
        <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
        <SetupNotice />
        <StudentSocialLinks />
        <section className="panel form-panel session-closed-card">
          <h1>{locale === 'en' ? 'Class ended' : '下課啦！'}</h1>
          <p className="muted">{locale === 'en' ? 'This class has ended. You can no longer join or submit content.' : '這堂課已經結束，無法再加入或送出內容。'}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="center-page">
      <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
      <SetupNotice />
      <StudentSocialLinks />
      <form autoComplete="off" className="panel form-panel" onSubmit={join}>
        <span className="form-heading-icon"><UserRound size={24} /></span>
        <h1>{locale === 'en' ? `Join ${session?.title || 'session'}` : `加入${session?.title || '場次'}`}</h1>
        <p className="muted">{locale === 'en' ? 'Enter your name to join the interactive class' : '輸入姓名後即可進入互動課堂'}</p>
        <label>
          {locale === 'en' ? 'Your name' : '你的姓名'}
          <input
            autoComplete="name"
            autoFocus
            inputMode="text"
            name="participant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={locale === 'en' ? 'Enter your name' : '請輸入姓名'}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? (locale === 'en' ? 'Joining...' : '加入中...') : (locale === 'en' ? 'Join' : '加入')}
          {!busy && <ArrowRight size={18} />}
        </button>
      </form>
    </main>
  )
}
