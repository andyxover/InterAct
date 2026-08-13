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

  if (!apiKey) {
    return {
      status: 'skipped',
      output: { message: 'GEMINI_API_KEY is not configured.' },
    }
  }

  let response: Response | null = null
  let failureMessage = 'AI request failed.'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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
        signal: AbortSignal.timeout(55_000),
      })
      if (response.ok) break
      const detail = (await response.text()).slice(0, 1000)
      failureMessage = detail || `AI request failed with status ${response.status}.`
      if (attempt === 0 && retryableStatus(response.status)) {
        response = null
        await wait(1200)
        continue
      }
      break
    } catch (error) {
      failureMessage = error instanceof Error && error.name === 'TimeoutError' ? 'AI request timed out.' : 'AI request failed.'
      response = null
      if (attempt === 0) {
        await wait(1200)
        continue
      }
    }
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
