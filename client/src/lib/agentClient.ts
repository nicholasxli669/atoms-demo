/** 与 Python Agent 服务通信的客户端（大仓模式）；未配置 AGENT_URL 时返回不可用，由调用方回落本地流水线 */

import type { AgentEvent, Plan } from "./types";

const BASE = (process.env.AGENT_URL || "").replace(/\/+$/, "");

export interface AgentPayload {
  code: string;
  plan: Plan;
  mode: "new" | "edit";
  ok: boolean;
  issues: { level: string; msg: string }[];
  stats: { lines: number; bytes: number; hasStorage: boolean; external: number };
}

export type AgentOutgoing = AgentEvent | ({ t: "final" } & AgentPayload);

export interface AgentRunBody {
  message: string;
  mode: "new" | "edit";
  baseCode?: string;
  appName?: string;
  runtimeLogs?: string[];
}

/** 探测结果缓存：Agent 挂掉时不要在每次生成前都白等 1.5s */
let healthCache: { at: number; ok: boolean } | null = null;

/** Agent 是否可用：既要通，也要有模型密钥（没密钥时让 Web 走内置演示流水线） */
export async function agentHealthy(timeoutMs = 1500, ttlMs = 5000): Promise<boolean> {
  if (!BASE) return false;
  const now = Date.now();
  if (healthCache && now - healthCache.at < ttlMs) return healthCache.ok;

  let ok = false;
  try {
    const res = await fetch(`${BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const info = (await res.json()) as { ok?: boolean; ready?: boolean };
      ok = info.ok === true && info.ready === true;
    }
  } catch {
    ok = false;
  }
  healthCache = { at: now, ok };
  return ok;
}

/**
 * 调 Agent 跑一次流水线：事件逐个回调，返回值是 final 载荷。
 * 断开连接时传 signal，Agent 那边的生成会被取消。
 */
export async function streamAgent(
  body: AgentRunBody,
  onEvent: (e: AgentOutgoing) => void,
  signal?: AbortSignal,
): Promise<AgentPayload> {
  const res = await fetch(`${BASE}/v1/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Agent ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: AgentPayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      let event: AgentOutgoing;
      try {
        event = JSON.parse(line.slice(5).trim()) as AgentOutgoing;
      } catch {
        continue;
      }
      if (event.t === "error") throw new Error(event.message);
      if (event.t === "final") {
        final = event;
        continue;
      }
      onEvent(event);
    }
  }

  if (!final) throw new Error("Agent 未返回 final 事件");
  return final;
}
