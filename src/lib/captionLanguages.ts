export const CAPTION_LANGUAGES = [
  { code: 'zh-tw', label: '繁體中文' },
  { code: 'zh-cn', label: '簡體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Bahasa Indonesia' },
] as const

export const DEFAULT_CAPTION_LANGUAGE = 'zh-tw'

export function captionLanguageLabel(code: string) {
  return CAPTION_LANGUAGES.find((language) => language.code === code)?.label || code
}
