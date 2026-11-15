import { validateApp } from "./validate.ts";
import type { Report, Step } from "./types";

/**
 * 质量验收报告：把「检查了什么、修了几轮、多大、多久」压成一张可展示的卡。
 * 纯函数，输入最终源码 + 过程步骤 + 耗时即可，方便单测。
 *
 * repairs 统计 repair / repair-1 / repair-2 …（自动修复与按运行时报错修复）
 * continuations 统计 continue-1 / continue-2 …（8k 输出上限导致截断后的续写）
 */
export function buildReport(input: {
  code: string;
  steps: Step[];
  mode: "new" | "edit";
  ms: number;
  at?: number;
}): Report {
  const v = validateApp(input.code);
  const count = (prefix: string) => input.steps.filter((s) => s.key.startsWith(prefix)).length;

  return {
    ok: v.ok,
    checks: v.checks,
    repairs: count("repair"),
    continuations: count("continue"),
    lines: v.stats.lines,
    bytes: v.stats.bytes,
    warns: v.issues.filter((i) => i.level === "warn").length,
    ms: Math.max(0, Math.round(input.ms)),
    mode: input.mode,
    at: input.at ?? Date.now(),
  };
}

/** 报告卡标题：一句话说清这轮到底经历了什么 */
export function verdict(r: Report): string {
  const kb = (r.bytes / 1024).toFixed(1);
  if (!r.ok) return `未通过静态体检 —— ${r.checks.filter((c) => !c.ok).length} 项不合格`;

  const fixed: string[] = [];
  if (r.repairs > 0) fixed.push(`自动修复 ${r.repairs} 轮`);
  if (r.continuations > 0) fixed.push(`续写 ${r.continuations} 次`);

  if (fixed.length > 0) return `首轮未过，${fixed.join(" + ")}后通过（${r.lines} 行 / ${kb} KB）`;
  return `首轮即通过，无需修复（${r.lines} 行 / ${kb} KB）`;
}

/** 有多少项没通过（给徽标用） */
export function failedCount(r: Report): number {
  return r.checks.filter((c) => !c.ok).length;
}
