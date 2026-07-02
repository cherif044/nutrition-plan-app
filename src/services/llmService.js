const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 8192;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 120_000;

const LOCAL_LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434/v1/chat/completions';
const LOCAL_LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5';

function parseJsonFromLLM(raw) {
  // Strip markdown fences
  const text = String(raw || '').replace(/```json|```/g, '').trim();
  // Try direct parse first
  try { return JSON.parse(text); } catch (_) {}
  // Extract first {...} block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  throw new Error(`LLM returned non-JSON: ${text.slice(0, 80)}`);
}

function toTextContent(content) {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function toGeminiRequest(messages) {
  const systemParts = [];
  const contents = [];

  for (const message of messages) {
    const text = toTextContent(message.content);
    if (!text) continue;

    if (message.role === 'system') {
      systemParts.push({ text });
    } else {
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      });
    }
  }

  return {
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  };
}

async function readErrorBody(response) {
  try {
    const body = await response.text();
    return body ? `: ${body.slice(0, 300)}` : '';
  } catch (_) {
    return '';
  }
}

async function chatWithGemini(messages) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(toGeminiRequest(messages)),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status}${await readErrorBody(response)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const raw = candidate?.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text || '')
    .join('') || '';

  if (!raw.trim()) {
    throw new Error(`Gemini returned no final JSON output. finishReason=${candidate?.finishReason || 'unknown'}`);
  }

  return parseJsonFromLLM(raw);
}

async function chatWithLocalLLM(messages) {
  const response = await fetch(LOCAL_LLM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LOCAL_LLM_MODEL,
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
    throw new Error(`Local LLM request failed: ${response.status}${await readErrorBody(response)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return parseJsonFromLLM(raw);
}

async function chatWithLLM(messages) {
  if (GEMINI_API_KEY) {
    return chatWithGemini(messages);
  }

  return chatWithLocalLLM(messages);
}

module.exports = { chatWithLLM };
