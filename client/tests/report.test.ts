import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, verdict, failedCount } from "../src/lib/report.ts";
import type { Step } from "../src/lib/types.ts";

/** 贴近真实产物的样本：体积必须 ≥500 字节，否则会被体积检查判失败 */
const CSS = `
:root{--bg:#0b0b10;--card:#15151d;--ink:#ecedf4;--muted:#9c9cb0;--accent:#8b7cff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}
header{padding:24px 18px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
h1{margin:0;font-size:20px;letter-spacing:.2px}
.sub{color:var(--muted);font-size:13px;margin-top:6px}
main{padding:18px;max-width:720px;margin:0 auto;display:grid;gap:12px}
.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px}
.row{display:flex;gap:10px;align-items:center}
input,button{font:inherit}
input{flex:1;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:#0f0f16;color:var(--ink)}
button{cursor:pointer;border:0;border-radius:9px;padding:9px 14px;background:var(--accent);color:#fff}
button:hover{filter:brightness(1.08)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
li{display:flex;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:9px;background:#101018}
.done{opacity:.55;text-decoration:line-through}
.empty{color:var(--muted);font-size:13px;text-align:center;padding:18px 0}
`;

const GOOD = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>示例应用</title><style>${CSS}</style></head>
<body><header><h1>示例应用</h1><div class="sub">离线单文件 · 数据存在本地</div></header>
<main><section class="card"><div class="row"><input id="t" placeholder="要做什么"><button id="add">添加</button></div></section>
<ul id="list"></ul></main>
<script>
const KEY = "app:demo";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; } };
const save = (v) => localStorage.setItem(KEY, JSON.stringify(v));
function render() {
  const list = document.getElementById("list");
  const items = read();
  list.innerHTML = items.length ? "" : '<li class="empty">还没有内容</li>';
  items.forEach((it) => { const li = document.createElement("li"); li.textContent = it.text; list.appendChild(li); });
}
document.getElementById("add").onclick = () => {
  const input = document.getElementById("t");
  if (!input.value.trim()) return;
  save([...read(), { id: Date.now(), text: input.value.trim() }]);
  input.value = ""; render();
};
render();
</script></body></html>`;

const step = (key: string, status: Step["status"] = "ok"): Step => ({ key, label: key, status });

test("首轮通过：无修复无续写", () => {
  const r = buildReport({ code: GOOD, steps: [], mode: "new", ms: 17_400 });
  assert.equal(r.ok, true, `应当通过，实际不合格项：${JSON.stringify(r.checks.filter((c) => !c.ok))}`);
  assert.equal(r.repairs, 0);
  assert.equal(r.continuations, 0);
  assert.equal(r.warns, 0);
  assert.equal(r.ms, 17400);
  assert.equal(r.checks.length, 7);
  assert.ok(r.checks.every((c) => c.ok), "合法样本应 7 项全过");
  assert.match(verdict(r), /首轮即通过/);
});

test("修复与续写次数从步骤 key 前缀统计，不受同一轮 run/ok 两次事件影响", () => {
  const steps = [
    step("plan"),
    step("code"),
    step("validate", "err"),
    step("repair-1", "err"),
    step("repair-2"),
    step("continue-1"),
    step("persist"),
  ];
  const r = buildReport({ code: GOOD, steps, mode: "edit", ms: 74_165 });
  assert.equal(r.repairs, 2);
  assert.equal(r.continuations, 1);
  assert.equal(r.mode, "edit");
  assert.match(verdict(r), /自动修复 2 轮 \+ 续写 1 次后通过/);
});

test("截断的代码判为不通过，并指出不合格项", () => {
  const truncated = GOOD.slice(0, GOOD.indexOf("<body"));
  const r = buildReport({ code: truncated, steps: [step("code")], mode: "new", ms: 8000 });
  assert.equal(r.ok, false);
  assert.ok(failedCount(r) >= 2, "缺 body 且缺 </html>，至少 2 项不合格");
  assert.match(verdict(r), /未通过静态体检/);
});

test("无 localStorage 的外链应用：通过但有建议", () => {
  const code = `<!DOCTYPE html><html><head><title>t</title>
<link rel="stylesheet" href="https://cdn.example.com/a.css"><style>${CSS}</style></head>
<body><div id="x">hi</div><script>document.getElementById("x").onclick=()=>1;</script></body></html>`;
  const r = buildReport({ code, steps: [step("code")], mode: "new", ms: 9000 });
  assert.equal(r.ok, true);
  assert.ok(r.warns >= 2, "应至少报告 localStorage 缺失与外链两条建议");
  assert.equal(r.checks.find((c) => c.key === "storage")?.ok, false);
  assert.equal(r.checks.find((c) => c.key === "offline")?.ok, false);
});
