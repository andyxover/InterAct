export const MESSAGE_MAX_CJK_CHARACTERS = 36
export const MESSAGE_MAX_ENGLISH_WORDS = 24
export const MESSAGE_MAX_RAW_CHARACTERS = 180

const cjkPattern = /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const latinWordCharacterPattern = /[A-Za-z0-9]/
const latinWordJoinerPattern = /['’-]/

export function messageUsage(value: string) {
  let cjkCharacters = 0
  let englishWords = 0
  let symbols = 0
  let insideEnglishWord = false

  for (const character of Array.from(value.trim())) {
    if (cjkPattern.test(character)) {
      cjkCharacters += 1
      insideEnglishWord = false
    } else if (latinWordCharacterPattern.test(character)) {
      if (!insideEnglishWord) englishWords += 1
      insideEnglishWord = true
    } else if (insideEnglishWord && latinWordJoinerPattern.test(character)) {
      // Apostrophes and hyphens keep a Latin word together.
    } else {
      insideEnglishWord = false
      if (!/\s/.test(character)) symbols += 1
    }
  }

  const units = cjkCharacters
    + englishWords * (MESSAGE_MAX_CJK_CHARACTERS / MESSAGE_MAX_ENGLISH_WORDS)
    + symbols * 0.5

  return {
    cjkCharacters,
    englishWords,
    rawCharacters: Array.from(value).length,
    symbols,
    units,
  }
}

export function messageFitsLimit(value: string) {
  const usage = messageUsage(value)
  return usage.rawCharacters <= MESSAGE_MAX_RAW_CHARACTERS
    && usage.units <= MESSAGE_MAX_CJK_CHARACTERS
}
