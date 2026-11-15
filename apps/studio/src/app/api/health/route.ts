import { NextResponse } from "next/server";
import { llmReady, MODEL } from "@/lib/llm";
import { storeInfo } from "@/lib/store";

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
  return NextResponse.json({
    ok: true,
    mode: llmReady() ? "live" : "demo",
    model: llmReady() ? MODEL : "内置示例（离线演示）",
    store: driver,
    persistent,
    time: new Date().toISOString(),
  });
}
