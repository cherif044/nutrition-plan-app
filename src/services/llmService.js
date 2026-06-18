const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5';

function parseJsonFromLLM(raw) {
  // Strip markdown fences
  let text = raw.replace(/```json|```/g, '').trim();
  // Try direct parse first
  try { return JSON.parse(text); } catch (_) {}
  // Extract first {...} block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  throw new Error(`LLM returned non-JSON: ${text.slice(0, 80)}`);
}

async function chatWithLLM(messages) {
  const response = await fetch(LLM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      stream: false,
      format: 'json',
      response_format: { type: 'json_object' },
      options: {
        temperature: 0.2,
        num_predict: 1200,
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices[0].message.content;
  return parseJsonFromLLM(raw);
}

module.exports = { chatWithLLM };
