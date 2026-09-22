export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-interact-client, apikey, content-type',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

export type AiProfile = 'realtime' | 'deep'

type GeminiRequestOptions = {
  primaryTimeoutMs?: number
  fallbackTimeoutMs?: number
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

export function geminiModels(profile: AiProfile) {
  if (profile === 'deep') {
    const primary = Deno.env.get('GEMINI_DEEP_MODEL') || Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash'
    const fallback = Deno.env.get('GEMINI_DEEP_FALLBACK_MODEL') || Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.7-flash'
    // A third model, because capacity trouble tends to hit the newest two
    // together; the notes must still arrive.
    const last = Deno.env.get('GEMINI_DEEP_LAST_MODEL') || 'gemini-3.6-flash'
    return [...new Set([primary, fallback, last])]
  }

  const primary = Deno.env.get('GEMINI_REALTIME_MODEL') || 'gemini-3.8-flash'
  const fallback = Deno.env.get('GEMINI_REALTIME_FALLBACK_MODEL') || 'gemini-3.6-flash'
  return fallback === primary ? [primary] : [primary, fallback]
}

export function geminiThinkingConfig(profile: AiProfile) {
  // Medium for the after-class notes: high thinking on the newest Flash was
  // refused as "high demand" for an entire evening, and medium notes that
  // arrive beat thorough notes that do not. Low for anything a class waits on.
  return { thinkingLevel: profile === 'deep' ? 'MEDIUM' : 'LOW' }
}

export async function requestGemini(
  body: string,
  profile: AiProfile,
  options: GeminiRequestOptions = {},
) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')

  const models = geminiModels(profile)
  // Deep work runs in the background (EdgeRuntime.waitUntil), where the
  // runtime allows several minutes; realtime work answers a waiting class.
  const primaryTimeoutMs = options.primaryTimeoutMs ?? (profile === 'deep' ? 150_000 : 12_000)
  const fallbackTimeoutMs = options.fallbackTimeoutMs ?? (profile === 'deep' ? 90_000 : 18_000)
  let failureMessage = 'AI request failed.'

  // A "high demand" 503 from Gemini usually clears in a few seconds. Each
  // model gets a second try after a short pause before we move to the
  // fallback, and deep work — after-class notes, with nobody waiting — gets
  // one more pass over the whole chain. A wrong model name (404) or a bad
  // request is not retried.
  const attemptsPerModel = 2
  const passes = 1
  for (let pass = 0; pass < passes; pass += 1) {
    for (const [index, model] of models.entries()) {
      for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
        if (attempt > 0 || pass > 0) await new Promise((resolve) => setTimeout(resolve, attempt > 0 ? 2500 : 6000))
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: {
              'x-goog-api-key': apiKey,
              'Content-Type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(index === 0 ? primaryTimeoutMs : fallbackTimeoutMs),
          })
          if (response.ok) return response

          failureMessage = (await response.text()).slice(0, 1000) || `AI request failed with status ${response.status}.`
          if (!retryableStatus(response.status)) {
            const nonRetryableError = new Error(failureMessage)
            nonRetryableError.name = 'NonRetryableGeminiError'
            throw nonRetryableError
          }
          console.warn(`Gemini ${response.status} on ${model} (attempt ${attempt + 1}, pass ${pass + 1}).`)
        } catch (error) {
          if (error instanceof Error && error.name === 'NonRetryableGeminiError') throw error
          failureMessage = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? `AI request timed out on ${model}.`
            : error instanceof Error ? error.message : 'AI request failed.'
          // A timeout already spent the budget; do not double it.
          if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) break
        }
      }
      if (index < models.length - 1) console.warn(`Gemini unavailable on ${model}; switching to ${models[index + 1]}.`)
    }
  }

  throw new Error(failureMessage)
}

export async function callAiJson(
  systemPrompt: string,
  userPayload: unknown,
  schema?: Record<string, unknown>,
  profile: AiProfile = 'realtime',
) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')

  if (!apiKey) {
    return {
      status: 'skipped',
      output: { message: 'GEMINI_API_KEY is not configured.' },
    }
  }

  let response: Response
  try {
    response = await requestGemini(JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
      generationConfig: {
        thinkingConfig: geminiThinkingConfig(profile),
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', ...(schema ? { schema } : {}) } },
      },
    }), profile)
  } catch (error) {
    return { status: 'failed', output: { message: error instanceof Error ? error.message : 'AI request failed.' } }
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || ''

  try {
    return { status: 'success', output: JSON.parse(content) }
  } catch {
    return { status: 'success', output: { raw: content } }
  }
}
