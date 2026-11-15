/** 生成完成后的汇总文案（纯函数，便于单测） */
import type { Plan } from "./types";

export function buildSummary(o: {
  plan: Plan;
  mode: "new" | "edit";
  stats: { lines: number; bytes: number; hasStorage: boolean };
  warns: number;
  live: boolean;
  ok: boolean;
  errors?: string[];
}): string {
  const head =
    o.mode === "edit"
      ? `已按你的要求更新「${o.plan.name}」，新版本已保存。`
      : `「${o.plan.name}」已生成并保存版本。${o.plan.summary ? "\n" + o.plan.summary : ""}`;
  // 校验没通过就明说，绝不把残缺版本包装成"成功"
  const warn = o.ok
    ? ""
    : `\n⚠ 静态校验未通过${o.errors?.length ? "：" + o.errors.slice(0, 2).join("；") : ""}。已保存供你查看，建议继续对话让它修复。`;
  const facts = [
    `代码 ${o.stats.lines} 行 · ${(o.stats.bytes / 1024).toFixed(1)} KB`,
    o.stats.hasStorage ? "数据用 localStorage 持久化，刷新不丢" : "未检测到 localStorage",
    !o.ok ? "⚠ 存在阻塞问题" : o.warns ? `${o.warns} 条优化建议` : "静态校验通过",
    o.live ? "" : "（离线演示模式：由内置模板产出）",
  ].filter(Boolean);
  const acts = o.plan.features.length ? `\n交互：${o.plan.features.join(" · ")}` : "";
  return `${head}${warn}\n${facts.join(" · ")}${acts}`;
}
