import type { RealtimeChannel } from '@supabase/supabase-js'
import { partialFromPayload } from './captionText'
import type { CaptionPartial } from './captionText'
import { isSupabaseConfigured, requireSupabase } from './supabase'
import type { Caption } from '../types'

// One realtime channel per session, shared by everything in the window that
// talks captions: the presenter's sender, the caption bar, the transcript
// panel, the interpreter. Two channels with the same topic on one client
// conflict, and tearing one down while another is joining silently kills
// delivery — so the channel is created once per session and kept for the
// page's lifetime, and callers subscribe to it through reference-counted
// listener sets.
//
// Two events travel on it:
//   partial — the in-progress sentence, word by word, with rolling translation
//   final   — the finished caption row, sent by the presenter the moment the
//             server has stored it. Viewers used to wait for the database's
//             change feed to tell them; that feed is slower, and with thirty
//             phones each holding three subscriptions it was the thing that
//             sometimes never arrived. The change feed is kept as a fallback
//             and both paths are de-duplicated by caption id.

type FinalListener = (caption: Caption) => void
type PartialListener = (partial: CaptionPartial) => void

type Entry = {
  channel: RealtimeChannel
  joined: Promise<void>
  partialListeners: Set<PartialListener>
  finalListeners: Set<FinalListener>
  seen: Set<string>
  fallback: RealtimeChannel | null
}

const entries = new Map<string, Entry>()

function entryFor(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (entry) return entry
  const supabase = requireSupabase()
  let resolveJoined: () => void = () => {}
  const joined = new Promise<void>((resolve) => { resolveJoined = resolve })
  const channel = supabase
    .channel(`caption-live:${sessionId}`)
    .on('broadcast', { event: 'partial' }, (message) => {
      const partial = partialFromPayload(message.payload)
      entries.get(sessionId)?.partialListeners.forEach((listener) => listener(partial))
    })
    .on('broadcast', { event: 'final' }, (message) => {
      const caption = (message.payload as { caption?: Caption } | undefined)?.caption
      if (caption && typeof caption.id === 'string') deliverFinal(sessionId, caption)
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') resolveJoined()
    })
  entry = { channel, joined, partialListeners: new Set(), finalListeners: new Set(), seen: new Set(), fallback: null }
  entries.set(sessionId, entry)
  return entry
}

function deliverFinal(sessionId: string, caption: Caption) {
  const entry = entries.get(sessionId)
  if (!entry) return
  if (entry.seen.has(caption.id)) return
  entry.seen.add(caption.id)
  // Bounded: a two-hour lecture is a few thousand ids, which is nothing, but
  // it should not grow forever in a kiosk window left open all day.
  if (entry.seen.size > 5000) entry.seen.clear()
  entry.finalListeners.forEach((listener) => listener(caption))
}

/** The shared channel, joined. Presenter-side senders wait on this so the first words are not dropped. */
export async function liveChannelReady(sessionId: string): Promise<RealtimeChannel> {
  const entry = entryFor(sessionId)
  await entry.joined
  return entry.channel
}

export function subscribeLivePartials(sessionId: string, callback: PartialListener) {
  if (!isSupabaseConfigured || !sessionId) return () => {}
  const entry = entryFor(sessionId)
  entry.partialListeners.add(callback)
  return () => {
    entries.get(sessionId)?.partialListeners.delete(callback)
  }
}

/**
 * Finished captions, from the presenter's broadcast first and the database's
 * change feed as a fallback, each caption delivered once. The fallback is one
 * subscription per page however many components listen.
 */
export function subscribeLiveFinals(sessionId: string, callback: FinalListener) {
  if (!isSupabaseConfigured || !sessionId) return () => {}
  const entry = entryFor(sessionId)
  entry.finalListeners.add(callback)
  if (!entry.fallback) {
    entry.fallback = requireSupabase()
      .channel(`captions-fallback:${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captions', filter: `session_id=eq.${sessionId}` }, (payload) => {
        deliverFinal(sessionId, payload.new as Caption)
      })
      .subscribe()
  }
  return () => {
    entries.get(sessionId)?.finalListeners.delete(callback)
  }
}
