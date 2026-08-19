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

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function callAiJson(systemPrompt: string, userPayload: unknown, schema?: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'
  const fallbackModel = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.6-flash'

  if (!apiKey) {
    return {
      status: 'skipped',
      output: { message: 'GEMINI_API_KEY is not configured.' },
    }
  }

  let failureMessage = 'AI request failed.'
  let response: Response | null = null
  const models = fallbackModel !== model ? [model, fallbackModel] : [model]
  for (const currentModel of models) {
    const attempts = currentModel === model ? 1 : 2
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const candidate = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
            generationConfig: {
              responseFormat: { text: { mimeType: 'APPLICATION_JSON', ...(schema ? { schema } : {}) } },
            },
          }),
          signal: AbortSignal.timeout(currentModel === model ? 40_000 : 50_000),
        })
        if (candidate.ok) {
          response = candidate
          break
        }
        const detail = (await candidate.text()).slice(0, 1000)
        failureMessage = detail || `AI request failed with status ${candidate.status}.`
        if (!retryableStatus(candidate.status)) return { status: 'failed', output: { message: failureMessage } }
      } catch (error) {
        failureMessage = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'AI request timed out.'
          : 'AI request failed.'
      }
      if (attempt < attempts - 1) await wait(1200)
    }
    if (response) break
    if (currentModel !== models.at(-1)) console.warn(`Gemini unavailable on ${currentModel}; retrying with ${fallbackModel}.`)
  }

  if (!response?.ok) {
    return { status: 'failed', output: { message: failureMessage } }
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || ''

  try {
    return { status: 'success', output: JSON.parse(content) }
  } catch {
    return { status: 'success', output: { raw: content } }
  }
}
