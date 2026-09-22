// Spoken captions, synthesised once and kept in a public bucket so every
// listener fetches the same file. Shared by live-caption (which warms the
// audio the moment a caption is stored) and caption-tts (which a listener
// calls, and which normally finds the file already there).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.8'

export const TTS_BUCKET = 'interact-caption-audio'

export type SpokenCaption = {
  id: string
  session_id: string
  original: string
  original_lang: string | null
  text_zh: string | null
  text_en: string | null
}

function ttsModel() {
  return Deno.env.get('OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts'
}

function ttsVoice() {
  return Deno.env.get('OPENAI_TTS_VOICE') || 'alloy'
}

export function spokenTextFor(caption: SpokenCaption, lang: 'zh' | 'en') {
  return lang === 'en'
    ? caption.text_en || (caption.original_lang === 'en' ? caption.original : '')
    : caption.text_zh || (caption.original_lang === 'zh' ? caption.original : '')
}

/** The languages a listener might need spoken: everything the presenter did not speak. */
export function languagesToWarm(caption: SpokenCaption): Array<'zh' | 'en'> {
  if (caption.original_lang === 'zh') return ['en']
  if (caption.original_lang === 'en') return ['zh']
  return ['zh', 'en']
}

export function audioPath(caption: Pick<SpokenCaption, 'id' | 'session_id'>, lang: 'zh' | 'en') {
  return `${caption.session_id}/${caption.id}-${lang}.mp3`
}

async function synthesize(apiKey: string, text: string) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ttsModel(),
      voice: ttsVoice(),
      input: text,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`TTS failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The public URL of this caption's audio in the given language, synthesising
 * and storing it if nobody has yet. Returns null when there is nothing to say.
 */
export async function ensureSpokenCaption(
  supabase: SupabaseClient,
  apiKey: string,
  caption: SpokenCaption,
  lang: 'zh' | 'en',
): Promise<{ url: string; cached: boolean } | null> {
  const text = spokenTextFor(caption, lang)
  if (!text) return null
  const path = audioPath(caption, lang)
  const { data: publicUrlData } = supabase.storage.from(TTS_BUCKET).getPublicUrl(path)
  const publicUrl = publicUrlData.publicUrl

  const existing = await fetch(publicUrl, { method: 'HEAD' }).catch(() => null)
  if (existing?.ok) return { url: publicUrl, cached: true }

  const audio = await synthesize(apiKey, text)
  // Bucket is created lazily so deployments need no extra setup step.
  await supabase.storage.createBucket(TTS_BUCKET, { public: true }).catch(() => null)
  const { error: uploadError } = await supabase.storage
    .from(TTS_BUCKET)
    .upload(path, audio, { contentType: 'audio/mpeg', upsert: true })
  if (uploadError) throw uploadError
  return { url: publicUrl, cached: false }
}
