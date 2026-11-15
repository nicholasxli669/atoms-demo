import { NextResponse } from "next/server";
import { llmReady, MODEL } from "@/lib/llm";
import { storeInfo } from "@/lib/store";
import { agentHealthy } from "@/lib/agentClient";

export const dynamic = "force-dynamic";

export async function GET() {
  let driver = "unknown";
  let persistent = true;
  try {
    const info = await storeInfo();
    driver = info.driver;
    persistent = info.persistent;
  } catch {
    driver = "error";
  }

  // 一眼看出链路实际走哪条：ok = Python Agent 可用；off = 没配 AGENT_URL；down = 配了但连不上
  let agent: "ok" | "off" | "down" = "off";
  if (process.env.AGENT_URL) {
    agent = (await agentHealthy(600)) ? "ok" : "down";
  }

  return NextResponse.json({
    ok: true,
    mode: llmReady() ? "live" : "demo",
    model: llmReady() ? MODEL : "内置示例（离线演示）",
    store: driver,
    persistent,
    agent,
    time: new Date().toISOString(),
  });
}
