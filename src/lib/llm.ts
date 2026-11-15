/** LLM 客户端：兼容 OpenAI 协议（默认 DeepSeek），支持流式与一次性调用 */

const KEY =
  process.env.DEEPSEEK_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

const BASE = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");

export const MODEL = process.env.LLM_MODEL || "deepseek-chat";

export function llmReady(): boolean {
  return KEY.trim().length > 0;
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

interface Options {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

async function call(messages: ChatMsg[], opts: Options, stream: boolean) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream,
      temperature: opts.temperature ?? 0.35,
      max_tokens: opts.maxTokens ?? 4096,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/** 一次性返回（用于规划、命名等小请求） */
export async function chatOnce(messages: ChatMsg[], opts: Options = {}): Promise<string> {
  const res = await call(messages, { ...opts, maxTokens: opts.maxTokens ?? 512 }, false);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/** 流式返回文本增量 */
export async function* chatStream(
  messages: ChatMsg[],
  opts: Options = {},
): AsyncGenerator<string, void, unknown> {
  const res = await call(messages, { ...opts, maxTokens: opts.maxTokens ?? 8000 }, true);
  if (!res.body) throw new Error("LLM 无响应体");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      } catch {
        // 忽略不完整分片
      }
    }
  }
}
