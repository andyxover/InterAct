import type { RealtimeChannel } from '@supabase/supabase-js'
import { partialFromPayload } from './captionText'
import type { CaptionPartial } from './captionText'
import { isSupabaseConfigured, requireSupabase } from './supabase'

// One realtime channel per session topic, shared by every component in the
// window (caption bar, transcript panel). Two channels with the same topic on
// one client conflict, so subscriptions are reference-counted here instead.
const listeners = new Map<string, Set<(partial: CaptionPartial) => void>>()
const channels = new Map<string, RealtimeChannel>()

export function subscribeLivePartials(sessionId: string, callback: (partial: CaptionPartial) => void) {
  if (!isSupabaseConfigured || !sessionId) return () => {}

  let sessionListeners = listeners.get(sessionId)
  if (!sessionListeners) {
    sessionListeners = new Set()
    listeners.set(sessionId, sessionListeners)
  }
  sessionListeners.add(callback)

  if (!channels.has(sessionId)) {
    const channel = requireSupabase()
      .channel(`caption-live:${sessionId}`)
      .on('broadcast', { event: 'partial' }, (message) => {
        const partial = partialFromPayload(message.payload)
        listeners.get(sessionId)?.forEach((listener) => listener(partial))
      })
      .subscribe()
    channels.set(sessionId, channel)
  }

  return () => {
    // The channel itself is kept for the page's lifetime: tearing it down and
    // immediately re-creating the same topic (React dev double-mount, panel
    // open/close) races the realtime leave/join and silently kills delivery.
    listeners.get(sessionId)?.delete(callback)
  }
}
