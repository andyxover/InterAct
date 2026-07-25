import type { Session } from '../types'
import { listPresenterCredentials, removePresenterToken } from './presenterAuth'
import { requireSupabase } from './supabase'

export type ManagedSession = Pick<Session, 'id' | 'title' | 'code' | 'status' | 'created_at' | 'ended_at'>

async function functionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const response = (error as Error & { context?: Response }).context
  if (!response) return error.message || fallback
  try {
    const body = await response.clone().json()
    if (typeof body?.message === 'string') return body.message
  } catch {
    // Use the SDK message when the Edge Function response is not JSON.
  }
  return error.message || fallback
}

export async function listManagedSessions() {
  const credentials = listPresenterCredentials()
  if (!credentials.length) return []

  const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
    body: { action: 'list_sessions', credentials },
  })
  if (error) throw new Error(await functionErrorMessage(error, '無法讀取場次清單。'))
  return (data?.sessions || []) as ManagedSession[]
}

export async function endManagedSession(sessionId: string, presenterToken: string) {
  const { error } = await requireSupabase().functions.invoke('presenter-action', {
    body: { action: 'end_session', sessionId, presenterToken },
  })
  if (error) throw new Error(await functionErrorMessage(error, '無法關閉場次。'))

  const { error: analysisError } = await requireSupabase().functions.invoke('analyze-session', {
    body: { sessionId, presenterToken },
  })
  return analysisError
    ? { analysisWarning: await functionErrorMessage(analysisError, '場次已關閉，但 AI 課程總結尚未完成。') }
    : { analysisWarning: '' }
}

export async function deleteManagedSession(sessionId: string, presenterToken: string) {
  const { error } = await requireSupabase().functions.invoke('presenter-action', {
    body: { action: 'delete_session', sessionId, presenterToken },
  })
  if (error) throw new Error(await functionErrorMessage(error, '無法永久移除場次。'))
  removePresenterToken(sessionId)
}
