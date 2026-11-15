/**
 * 端到端验证：真实调用 /api/generate（会消耗模型额度）
 * 用法：node scripts/verify.mjs [baseUrl]
 */

import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || process.env.BASE || "http://localhost:3000";
const OUT = path.join(process.cwd(), "scripts", ".out");

const t0 = Date.now();
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`\x1b[31m✗\x1b[0m ${m}`);
  process.exitCode = 1;
};

async function json(pathname, init) {
  const r = await fetch(BASE + pathname, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathname} -> ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function runAgent(projectId, message, opts = {}) {
  const res = await fetch(BASE + "/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, message, ...opts }),
  });
  if (!res.ok || !res.body) throw new Error("generate failed: " + (await res.text()).slice(0, 300));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!frame.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(frame.slice(5).trim()));
      } catch {
        /* ignore */
      }
    }
  }
  return events;
}

function summarize(events) {
  const steps = events.filter((e) => e.t === "step");
  const version = events.find((e) => e.t === "version")?.version;
  const val = [...events].reverse().find((e) => e.t === "validate");
  const err = events.find((e) => e.t === "error");
  return { steps, version, val, err };
}

async function main() {
  console.log(`\n=== Atoms Demo 端到端验证 @ ${BASE} ===\n`);

  // 1. health
  const h = await json("/api/health");
  ok(`health: mode=${h.mode} model=${h.model} store=${h.store}`);
  if (h.mode !== "live") console.log("  ⚠ 未配置 API Key，本次为离线演示模式");

  // 2. 建项目
  const { project } = await json("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  ok(`创建项目 ${project.id} (${project.name})`);

  // 3. 首轮生成
  const prompt =
    "做一个习惯打卡工具：可以添加多个习惯，每天点击打卡，显示当前连续打卡天数和本月完成率，用方格热力图展示最近 30 天，数据存在浏览器本地";
  console.log(`\n[1/3] 生成：${prompt.slice(0, 28)}…`);
  const tGen = Date.now();
  const ev1 = await runAgent(project.id, prompt, { mode: "new" });
  const s1 = summarize(ev1);
  s1.steps.forEach((s) => console.log(`   · [${s.status}] ${s.label}${s.detail ? " — " + s.detail.slice(0, 90) : ""}`));
  if (s1.err) bad(`生成报错：${s1.err.message}`);
  if (!s1.version) throw new Error("没有返回版本");
  ok(
    `首轮完成 ${((Date.now() - tGen) / 1000).toFixed(1)}s · ${s1.version.code.length} 字符 · 校验 ${s1.val?.ok ? "通过" : "未通过"}`,
  );
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "v1.html"), s1.version.code, "utf8");
  ok(`已保存 ${path.relative(process.cwd(), path.join(OUT, "v1.html"))}`);

  // 代码质量抽查
  const code = s1.version.code;
  const checks = [
    [/<!doctype html/i, "含 DOCTYPE"],
    [/<style[\s>]/i, "含内联样式"],
    [/<script[\s>]/i, "含脚本"],
    [/localstorage/i, "使用 localStorage"],
    [/<html[\s\S]*<\/html>/i, "HTML 闭合"],
  ];
  for (const [re, label] of checks) {
    if (re.test(code)) ok(`   ${label}`);
    else bad(`   ${label} 缺失`);
  }

  // 4. 增量修改
  console.log("\n[2/3] 增量修改：把主色改成绿色并加一个今天日期显示");
  const ev2 = await runAgent(project.id, "把主题色改成绿色，并在页面顶部显示今天的日期与一句鼓励文案", {
    mode: "edit",
    baseCode: code,
  });
  const s2 = summarize(ev2);
  if (!s2.version) bad("修改没有产出新版本");
  else {
    ok(`新版本 ${s2.version.label} · ${s2.version.code.length} 字符 · 保留历史：${s2.version.code !== code ? "是" : "内容未变化"}`);
    fs.writeFileSync(path.join(OUT, "v2.html"), s2.version.code, "utf8");
  }

  // 5. 持久化校验
  console.log("\n[3/3] 持久化校验");
  const detail = await json(`/api/projects/${project.id}`);
  ok(`项目详情：${detail.messages.length} 条消息 / ${detail.versions.length} 个版本 / appName=${detail.project.appName}`);
  if (detail.versions.length < 2) bad("版本数不足 2");
  const list = await json("/api/projects");
  if (list.projects.some((p) => p.id === project.id)) ok(`项目出现在列表中（共 ${list.projects.length} 个）`);
  else bad("项目未出现在列表");

  console.log(
    `\n=== 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s ===\n` +
      `产物：${path.join(OUT, "v1.html")}\n`,
  );
}

main().catch((e) => {
  bad(e.message);
  process.exit(1);
});
