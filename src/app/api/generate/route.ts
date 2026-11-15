import { llmReady, chatOnce, chatStream } from "@/lib/llm";
import { planMessages, codeMessages, editMessages, repairMessages, parsePlan } from "@/lib/prompts";
import { extractHtml, validateApp, type Issue } from "@/lib/validate";
import { demoApp } from "@/lib/demoTemplates";
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

  const live = llmReady();
  const encoder = new TextEncoder();
  const state = { closed: false };

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
          setStep("repair", `工程师 · 自动修复第 ${round} 轮`, "run");
          code = await repairOnce(code, v.issues, body.runtimeLogs, push);
          v = validateApp(code);
          setStep(
            "repair",
            `工程师 · 自动修复第 ${round} 轮`,
            v.ok ? "ok" : "err",
            v.ok ? "校验通过" : v.issues.filter((i) => i.level === "error").map((e) => e.msg).join("；"),
          );
          push({ t: "validate", ok: v.ok, issues: v.issues });
        }

        // 5) 落库：版本 + 汇总消息 + 项目名
        const existing = await store.listVersions(projectId, false);
        const label = `v${existing.length + 1}`;
        const warnCount = v.issues.filter((i) => i.level === "warn").length;
        const summaryText = buildSummary({ plan, mode, stats: v.stats, warns: warnCount, live });

        const version: Version = await store.addVersion({
          projectId,
          label,
          code,
          summary: plan.summary,
        });
        setStep("persist", "工作区 · 保存版本", "ok", `${label} · ${(Buffer.byteLength(code, "utf8") / 1024).toFixed(1)} KB`);

        const autoRename =
          mode === "new" && (projectName === "新应用" || projectName === projectAppName);
        await store.updateProject(projectId, {
          appName: plan.name,
          ...(autoRename ? { name: plan.name } : {}),
        });
        await store.addMessage({
          projectId,
          role: "agent",
          content: summaryText,
          steps,
          plan,
          versionId: version.id,
        });

        push({ t: "version", version });
        push({ t: "summary", text: summaryText });
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

function buildSummary(o: {
  plan: Plan;
  mode: "new" | "edit";
  stats: { lines: number; bytes: number; hasStorage: boolean };
  warns: number;
  live: boolean;
}): string {
  const head =
    o.mode === "edit"
      ? `已按你的要求更新「${o.plan.name}」，新版本已保存。`
      : `「${o.plan.name}」已生成并保存版本。${o.plan.summary ? "\n" + o.plan.summary : ""}`;
  const facts = [
    `代码 ${o.stats.lines} 行 · ${(o.stats.bytes / 1024).toFixed(1)} KB`,
    o.stats.hasStorage ? "数据用 localStorage 持久化，刷新不丢" : "未检测到 localStorage",
    o.warns ? `${o.warns} 条优化建议` : "静态校验通过",
    o.live ? "" : "（离线演示模式：由内置模板产出）",
  ].filter(Boolean);
  const acts = o.plan.features.length ? `\n交互：${o.plan.features.join(" · ")}` : "";
  return `${head}\n${facts.join(" · ")}${acts}`;
}
