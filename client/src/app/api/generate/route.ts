import { llmReady, chatOnce, chatStream } from "@/lib/llm";
import {
  planMessages,
  codeMessages,
  editMessages,
  repairMessages,
  continueMessages,
  parsePlan,
} from "@/lib/prompts";
import { extractHtml, validateApp, type Issue } from "@/lib/validate";
import { demoApp } from "@/lib/demoTemplates";
import { buildSummary } from "@/lib/summary";
import { buildReport } from "@/lib/report";
import { agentHealthy, streamAgent } from "@/lib/agentClient";
import { store } from "@/lib/store";
import type { AgentEvent, Plan, Step, Version } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  projectId?: string;
  message?: string;
  mode?: "new" | "edit";
  baseCode?: string;
  runtimeLogs?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 同一项目的进行中标记：两轮同时生成会互相覆盖版本号、项目名与消息顺序。
 * 单实例部署（SQLite 单写者）下用内存锁足够；超过 maxDuration 视为僵死锁直接接管。
 */
const inFlight = new Map<string, number>();
const LOCK_TTL_MS = 330_000;

function guessName(prompt: string): string {
  const clean = prompt.replace(/[，。,.!?！？\s]+/g, "").slice(0, 12);
  return clean || "未命名应用";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const rawId = body.projectId;
  const rawMessage = (body.message || "").trim();
  const mode: "new" | "edit" = body.mode === "edit" ? "edit" : "new";

  if (!rawId || !rawMessage) {
    return new Response(JSON.stringify({ error: "缺少 projectId 或 message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId: string = rawId;
  const message: string = rawMessage;

  const found = await store.getProject(projectId);
  if (!found) {
    return new Response(JSON.stringify({ error: "项目不存在" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const projectName: string = found.name;
  const projectAppName: string | null = found.appName;

  const busySince = inFlight.get(projectId);
  if (busySince !== undefined && Date.now() - busySince < LOCK_TTL_MS) {
    return Response.json(
      { error: "这个项目正在生成中，等这一轮结束再发送" },
      { status: 409 },
    );
  }
  inFlight.set(projectId, Date.now());
  const startedAt = Date.now();

  const live = llmReady();
  const encoder = new TextEncoder();
  const state = { closed: false };
  // 用户点「停止」时用它掐断对 Agent 的请求，避免 Python 侧继续烧 token
  const abort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (e: AgentEvent) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          state.closed = true;
        }
      };

      try {
        await run(push);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push({ t: "error", message: msg.slice(0, 400) });
      } finally {
        push({ t: "end" });
        inFlight.delete(projectId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      async function run(push: (e: AgentEvent) => void) {
        const steps: Step[] = [];
        const setStep = (key: string, label: string, status: Step["status"], detail?: string) => {
          const i = steps.findIndex((s) => s.key === key);
          const step: Step = { key, label, status, detail };
          if (i >= 0) steps[i] = { ...steps[i], ...step };
          else steps.push(step);
          push({ t: "step", key, label, status, detail });
        };

        // 大仓模式：配置了 AGENT_URL 且 Python Agent 可用时，把 Agent 循环交给独立服务；
        // 否则用内置流水线（没起 Python 服务、或没有模型密钥时依然能完整演示）。
        if (await agentHealthy()) {
          await runViaAgent(push, setStep, steps);
          return;
        }

        // 1) 记录用户消息
        await store.addMessage({ projectId, role: "user", content: message });
        push({ t: "start", runId: `${Date.now()}` });

        // 2) 规划
        let plan: Plan;
        if (mode === "edit") {
          plan = { name: projectAppName || projectName, summary: "在已有应用上继续修改", features: [] };
        } else if (!live) {
          plan = demoApp(message).plan;
          setStep("plan", "产品经理 · 拆解需求并定方案", "skip", "离线演示模式：使用内置方案 " + plan.name);
          push({ t: "plan", plan });
        } else {
          setStep("plan", "产品经理 · 拆解需求并定方案", "run");
          try {
            const raw = await chatOnce(planMessages(message), { maxTokens: 420, temperature: 0.4 });
            plan = parsePlan(raw, guessName(message));
          } catch (e) {
            plan = { name: guessName(message), summary: "", features: [] };
            setStep("plan", "产品经理 · 拆解需求并定方案", "err", (e as Error).message.slice(0, 160));
          }
          if (steps[0].status === "run") {
            setStep(
              "plan",
              "产品经理 · 拆解需求并定方案",
              "ok",
              `${plan.name} · ${plan.features.length ? plan.features.join(" / ") : plan.summary || "已确定实现范围"}`,
            );
          }
          push({ t: "plan", plan });
        }

        // 3) 生成代码
        const baseCode =
          mode === "edit"
            ? (body.baseCode && body.baseCode.length > 200
                ? body.baseCode
                : (await store.listVersions(projectId)).slice(-1)[0]?.code) || ""
            : "";

        let code = "";
        const genLabel = mode === "edit" ? "工程师 · 按新要求改写" : "工程师 · 编写界面与交互";
        setStep("code", genLabel, "run");

        if (!live) {
          const demo = demoApp(mode === "edit" ? message : message).html;
          // 模拟流式，让交互体验与真实生成一致
          const chunk = 420;
          for (let i = 0; i < demo.length; i += chunk) {
            code += demo.slice(i, i + chunk);
            push({ t: "delta", chars: code.length });
            await sleep(35);
          }
          if (mode === "edit") {
            setStep("code", genLabel, "skip", "离线演示模式暂不支持增量修改，已重新生成示例应用");
          }
        } else {
          const messages =
            mode === "edit"
              ? editMessages({ instruction: message, prevCode: baseCode })
              : codeMessages({ prompt: message, plan });
          let lastSent = 0;
          for await (const piece of chatStream(messages, { maxTokens: 8000, temperature: 0.3 })) {
            code += piece;
            if (code.length - lastSent > 120) {
              lastSent = code.length;
              push({ t: "delta", chars: code.length });
            }
          }
          code = extractHtml(code);
          const lines = code.split("\n").length;
          setStep("code", genLabel, "ok", `${lines} 行 · ${(Buffer.byteLength(code, "utf8") / 1024).toFixed(1)} KB`);
        }
        if (steps.find((s) => s.key === "code")?.status === "run") {
          const lines = code.split("\n").length;
          setStep("code", genLabel, "ok", `${lines} 行`);
        }

        // 3.5) 如果是"运行时错误修复"模式，把控制台日志作为额外上下文再跑一次修复
        if (mode === "edit" && body.runtimeLogs?.length && live) {
          setStep("repair", "工程师 · 按控制台报错定位修复", "run");
          const v0 = validateApp(code);
          const issues = [
            ...v0.issues,
            ...body.runtimeLogs.slice(0, 8).map((l) => ({ level: "error" as const, msg: `运行时报错：${l}` })),
          ];
          code = await repairOnce(code, issues, body.runtimeLogs, push);
          const after = validateApp(code);
          setStep("repair", "工程师 · 按控制台报错定位修复", after.ok ? "ok" : "err", after.ok ? "已重写并消除报错" : "仍有问题，建议继续对话修正");
        }

        // 4) 静态校验 + 自动修复
        let v = validateApp(code);
        const errs = v.issues.filter((i) => i.level === "error");
        setStep(
          "validate",
          "QA · 静态校验",
          v.ok ? "ok" : "err",
          v.ok
            ? `${v.stats.lines} 行 · localStorage ${v.stats.hasStorage ? "已接入" : "未使用"} · ${v.issues.length} 条建议`
            : errs.map((e) => e.msg).join("；"),
        );
        push({ t: "validate", ok: v.ok, issues: v.issues });

        let round = 0;
        while (!v.ok && round < 2 && live) {
          round += 1;
          setStep(`repair-${round}`, `工程师 · 自动修复第 ${round} 轮`, "run");
          code = await repairOnce(code, v.issues, body.runtimeLogs, push);
          v = validateApp(code);
          setStep(
            `repair-${round}`,
            `工程师 · 自动修复第 ${round} 轮`,
            v.ok ? "ok" : "err",
            v.ok ? "校验通过" : v.issues.filter((i) => i.level === "error").map((e) => e.msg).join("；"),
          );
          push({ t: "validate", ok: v.ok, issues: v.issues });
        }

        // 4.5) 截断恢复：模型单次输出上限（约 8k tokens）会把长文件截断在半途，
        //      特征是代码里根本没有 </html>。此时让模型从断点续写并拼接，比反复整篇重写更容易收敛。
        let cont = 0;
        const isTruncated = () => !/<\/html>\s*$/i.test(code.trim());
        while (!v.ok && isTruncated() && cont < 2 && live) {
          cont += 1;
          setStep(`continue-${cont}`, `工程师 · 续写被截断的尾部（第 ${cont} 次）`, "run");
          let more = "";
          for await (const d of chatStream(continueMessages(code.slice(-4000)), {
            maxTokens: 8000,
            temperature: 0.15,
          })) {
            more += d;
            push({ t: "delta", chars: code.length + more.length });
          }
          code = extractHtml(code + more);
          v = validateApp(code);
          setStep(
            `continue-${cont}`,
            `工程师 · 续写被截断的尾部（第 ${cont} 次）`,
            v.ok ? "ok" : "err",
            v.ok
              ? `${v.stats.lines} 行 · 续写后已闭环`
              : v.issues.filter((i) => i.level === "error").map((e) => e.msg).join("；"),
          );
          push({ t: "validate", ok: v.ok, issues: v.issues });
        }

        // 用户中途停止：不落库，避免"界面显示已取消、库里却多出一版"
        if (state.closed) return;

        // 5) 落库：版本 + 汇总消息 + 项目名（与 Agent 模式共用同一条落库逻辑）
        await persistRun({
          projectId,
          projectName,
          projectAppName,
          mode,
          plan,
          code,
          ok: v.ok,
          issues: v.issues.map((i) => ({ level: i.level, msg: i.msg })),
          stats: v.stats,
          live,
          startedAt,
          steps,
          push,
          setStep,
        });
      }

      /** 走 Python Agent：事件透传给浏览器，final 拿到的源码由 Web 落库。 */
      async function runViaAgent(
        push: (e: AgentEvent) => void,
        setStep: (key: string, label: string, status: Step["status"], detail?: string) => void,
        steps: Step[],
      ) {
        await store.addMessage({ projectId, role: "user", content: message });

        const baseCode =
          mode === "edit"
            ? (body.baseCode && body.baseCode.length > 200
                ? body.baseCode
                : (await store.listVersions(projectId)).slice(-1)[0]?.code) || ""
            : "";

        let final: Awaited<ReturnType<typeof streamAgent>>;
        try {
          final = await streamAgent(
            {
              message,
              mode,
              baseCode,
              appName: projectAppName || projectName,
              runtimeLogs: body.runtimeLogs,
            },
            (event) => {
              if (event.t === "step") {
                const i = steps.findIndex((s) => s.key === event.key);
                const step: Step = {
                  key: event.key,
                  label: event.label,
                  status: event.status,
                  detail: event.detail,
                };
                if (i >= 0) steps[i] = { ...steps[i], ...step };
                else steps.push(step);
              }
              if (event.t !== "final") push(event as AgentEvent);
            },
            abort.signal,
          );
        } catch (e) {
          if (state.closed) return; // 用户主动停止：不落库、不报错
          // 失败时补一条 agent 消息，保证 messages 里 user/agent 成对（刷新后不留孤立的提问）
          const msg = e instanceof Error ? e.message : String(e);
          await store.addMessage({
            projectId,
            role: "agent",
            content: `生成失败：${msg.slice(0, 200)}`,
            steps,
          });
          throw e;
        }

        if (state.closed) return;

        await persistRun({
          projectId,
          projectName,
          projectAppName,
          mode,
          plan: final.plan,
          code: final.code,
          ok: final.ok,
          issues: final.issues,
          stats: final.stats,
          live: true,
          startedAt,
          steps,
          push,
          setStep,
        });
      }

      async function repairOnce(
        current: string,
        issues: Issue[],
        runtimeLogs: string[] | undefined,
        push: (e: AgentEvent) => void,
      ): Promise<string> {
        if (!live) return current;
        if (state.closed) return current;
        let out = "";
        try {
          for await (const piece of chatStream(
            repairMessages({ code: current, issues, runtimeLogs }),
            { maxTokens: 8000, temperature: 0.2 },
          )) {
            out += piece;
            push({ t: "delta", chars: current.length + out.length });
          }
        } catch {
          return current;
        }
        const fixed = extractHtml(out);
        return fixed.length > 500 ? fixed : current;
      }
    },
    cancel() {
      state.closed = true;
      abort.abort();
      inFlight.delete(projectId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

interface PersistInput {
  projectId: string;
  projectName: string;
  projectAppName: string | null;
  mode: "new" | "edit";
  plan: Plan;
  code: string;
  ok: boolean;
  issues: { level: string; msg: string }[];
  stats: { lines: number; bytes: number; hasStorage: boolean };
  live: boolean;
  steps: Step[];
  /** 本轮开始时间（算总耗时用） */
  startedAt: number;
  push: (e: AgentEvent) => void;
  setStep: (key: string, label: string, status: Step["status"], detail?: string) => void;
}

/**
 * 一次运行的收尾：存版本 → 改项目名 → 存 Agent 消息 → 推 version/summary。
 * 内置流水线与 Python Agent 两条路都走这里，避免落库逻辑分叉。
 */
async function persistRun(o: PersistInput): Promise<void> {
  const warns = o.issues.filter((i) => i.level === "warn").length;
  const summaryText = buildSummary({
    plan: o.plan,
    mode: o.mode,
    stats: o.stats,
    warns,
    live: o.live,
    ok: o.ok,
    errors: o.issues.filter((i) => i.level === "error").map((i) => i.msg),
  });

  const version: Version = await store.addVersion({
    projectId: o.projectId,
    code: o.code,
    summary: o.plan.summary,
  });
  const label = version.label; // 版本号由 store 在 SQL 里原子分配，避免并发撞号
  o.setStep(
    "persist",
    "工作区 · 保存版本",
    "ok",
    `${label} · ${(Buffer.byteLength(o.code, "utf8") / 1024).toFixed(1)} KB`,
  );

  const autoRename =
    o.mode === "new" && (o.projectName === "新应用" || o.projectName === o.projectAppName);
  await store.updateProject(o.projectId, {
    appName: o.plan.name,
    ...(autoRename ? { name: o.plan.name } : {}),
  });

  // 质量验收报告：把"检查了什么、修了几轮、多大、多久"固化成一张卡，
  // 随消息一起落库，所以刷新页面后历史消息里也看得到。
  const report = buildReport({
    code: o.code,
    steps: o.steps,
    mode: o.mode,
    ms: Date.now() - o.startedAt,
  });

  await store.addMessage({
    projectId: o.projectId,
    role: "agent",
    content: summaryText,
    steps: o.steps,
    plan: o.plan,
    versionId: version.id,
    report,
  });

  o.push({ t: "version", version });
  o.push({ t: "report", report });
  o.push({ t: "summary", text: summaryText });
}


