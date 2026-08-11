import { getAdminClient } from './supabase.ts'

const audioAnalysisCoreSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['pronunciation', 'oral_response'] },
    detected_language: { type: 'string' },
    transcript: { type: 'string' },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    summary: { type: 'string' },
    relevance: { type: 'string' },
    clarity: { type: 'string' },
    completeness: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'mode', 'detected_language', 'transcript', 'score', 'summary', 'relevance',
    'clarity', 'completeness', 'strengths', 'improvements', 'limitations',
  ],
}

const audioAnalysisSchema = {
  ...audioAnalysisCoreSchema,
  properties: {
    ...audioAnalysisCoreSchema.properties,
    translations: {
      type: 'object',
      additionalProperties: false,
      properties: { en: audioAnalysisCoreSchema },
      required: ['en'],
    },
  },
  required: [...audioAnalysisCoreSchema.required, 'translations'],
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function extractText(data: Record<string, unknown>) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : []
  const candidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined
  return candidate?.content?.parts?.map((part) => part.text || '').join('') || ''
}

export async function analyzeAudioResponse(input: {
  mode: 'pronunciation' | 'oral_response'
  promptText: string | null
  screenshotUrl: string
  audioBytes: Uint8Array
  audioMimeType: string
}) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')

  const imageResponse = await fetch(input.screenshotUrl)
  if (!imageResponse.ok) throw new Error(`Could not download screenshot (${imageResponse.status}).`)
  const imageBytes = new Uint8Array(await imageResponse.arrayBuffer())
  const imageMimeType = imageResponse.headers.get('content-type') || 'image/png'

  const modeInstruction = input.mode === 'pronunciation'
    ? '這是發音正確度評測。先從題目文字與截圖推斷應朗讀的內容，再自動辨識錄音語言，評估讀音、流暢度、漏讀、誤讀與可理解度。relevance 請描述錄音與指定朗讀內容的一致性，completeness 請描述是否完整朗讀。'
    : '這是口語回應評測。先從題目文字與截圖判讀問題，再自動辨識錄音語言，評估回答與問題的關聯性、表達清楚度與內容完整度；不要把口音本身視為錯誤。'

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: `你是 InterAct 的口語學習評測助理。請先使用繁體中文提供具體、尊重且可行的個別回饋，再於 translations.en 提供結構相同且忠實的英文翻譯；英文版不可另行評分或推論。${modeInstruction} transcript 必須忠實轉寫學員實際說出的內容。score 為 0 到 100 的整體表現分數。若音質不足、語音太短或無法辨識，請保守評分並在 limitations 說明，不可捏造內容。`,
        }],
      },
      contents: [{
        role: 'user',
        parts: [
          { text: JSON.stringify({ mode: input.mode, presenter_question: input.promptText }) },
          { inlineData: { mimeType: imageMimeType, data: bytesToBase64(imageBytes) } },
          { inlineData: { mimeType: input.audioMimeType, data: bytesToBase64(input.audioBytes) } },
        ],
      }],
      generationConfig: {
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: audioAnalysisSchema } },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000)
    throw new Error(`Gemini audio request failed (${response.status}): ${detail}`)
  }
  const output = extractText(await response.json())
  if (!output) throw new Error('Gemini returned no audio analysis.')
  return JSON.parse(output)
}

export async function removeRecording(storagePath: string) {
  await getAdminClient().storage.from('interact-recordings').remove([storagePath])
}
