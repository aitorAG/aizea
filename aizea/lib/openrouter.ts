// @deprecated Use lib/domain/llm/LLMClient.ts instead
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  throw new Error(
    "OPENROUTER_API_KEY no configurada. Crea un archivo .env con tu API key."
  );
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(messages: ChatMessage[], options?: { json?: boolean }) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 8000,
      response_format: options?.json ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content as string;
}

export async function chatJSON<T>(messages: ChatMessage[]): Promise<T> {
  const raw = await chat(messages, { json: true });
  // Sometimes the response is wrapped in markdown code fences
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as T;
}
