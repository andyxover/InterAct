import type { Caption } from '../types'

export type CaptionPartial = { text: string; lang?: string | null; zh?: string | null; en?: string | null }

export function partialFromPayload(payload: unknown): CaptionPartial {
  const record = (payload || {}) as Record<string, unknown>
  return {
    text: typeof record.text === 'string' ? record.text : '',
    lang: typeof record.lang === 'string' ? record.lang : null,
    zh: typeof record.zh === 'string' ? record.zh : null,
    en: typeof record.en === 'string' ? record.en : null,
  }
}

// The best in-progress text for a viewer of the given language: the original
// when it already matches, the rolling translation when one has arrived, and
// the original as a last resort (except strict mode, used by the overlay's
// English-only display, which returns nothing rather than the wrong language).
export function partialTextFor(partial: CaptionPartial, target: 'zh' | 'en', strict = false) {
  if (partial.lang === target) return partial.text
  const translated = target === 'en' ? partial.en : partial.zh
  if (translated) return translated
  return strict ? '' : partial.text
}

export function finalTextFor(caption: Caption, target: 'zh' | 'en') {
  if (target === 'en') return caption.text_en || (caption.original_lang === 'en' ? caption.original : '')
  return caption.text_zh || caption.original
}
