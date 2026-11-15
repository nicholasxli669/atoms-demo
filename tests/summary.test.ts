import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../src/lib/summary.ts";

const plan = { name: "极简待办", summary: "记录每天要做的事", features: ["添加任务", "勾选完成"] };
const base = { plan, mode: "new" as const, stats: { lines: 300, bytes: 12000, hasStorage: true }, warns: 0, live: true };

test("成功路径：不出现 ⚠，写清校验通过", () => {
  const s = buildSummary({ ...base, ok: true });
  assert.ok(!s.includes("⚠"));
  assert.ok(s.includes("静态校验通过"));
  assert.ok(s.includes("300 行"));
  assert.ok(s.includes("交互：添加任务 · 勾选完成"));
});

test("失败路径：显式标注，不包装成成功", () => {
  const s = buildSummary({ ...base, ok: false, errors: ["HTML 未闭合（缺少 </html>）", "<script> 标签不配对"] });
  assert.ok(s.includes("⚠ 静态校验未通过"));
  assert.ok(s.includes("HTML 未闭合"));
  assert.ok(s.includes("存在阻塞问题"));
  assert.ok(!s.includes("静态校验通过"));
});

test("编辑模式文案区分新建", () => {
  const s = buildSummary({ ...base, mode: "edit", ok: true });
  assert.ok(s.startsWith("已按你的要求更新"));
});

test("离线演示模式会标注出来", () => {
  const s = buildSummary({ ...base, ok: true, live: false });
  assert.ok(s.includes("离线演示模式"));
});
