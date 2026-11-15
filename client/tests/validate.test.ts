import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHtml, validateApp } from "../src/lib/validate.ts";

const GOOD = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>示例应用</title>
<style>
:root{--bg:#111;--ink:#eee;--card:#1c1c1c}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;line-height:1.6}
header{padding:24px 16px;border-bottom:1px solid #2a2a2a}
.card{background:var(--card);border-radius:12px;padding:16px;margin:16px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
button{cursor:pointer;border:0;border-radius:8px;padding:8px 14px;background:#4f46e5;color:#fff}
button:hover{opacity:.9}
</style></head>
<body><header><h1>示例应用</h1></header><main class="card"><div id="app"></div></main>
<script>
const KEY = "app:demo";
const seed = [{ id: 1, text: "示例任务", done: false }];
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? seed; } catch { return seed; } };
localStorage.setItem(KEY, JSON.stringify(read()));
document.getElementById("app").textContent = "ok";
</script></body></html>`;

test("extractHtml 去掉 markdown 围栏与前后解释", () => {
  const raw = "好的，下面是代码：\n```html\n" + GOOD + "\n```\n希望有帮助！";
  const out = extractHtml(raw);
  assert.ok(out.startsWith("<!DOCTYPE html>"));
  assert.ok(out.endsWith("</html>"));
});

test("完整应用校验通过", () => {
  const r = validateApp(GOOD);
  assert.equal(r.ok, true);
  assert.equal(r.stats.hasStorage, true);
  assert.equal(r.stats.hasStyle, true);
  assert.equal(r.stats.hasScript, true);
  assert.ok(r.issues.every((i) => i.level === "warn"));
});

test("被截断的输出（缺 </html>）判为失败 —— 这是续写恢复的触发条件", () => {
  const cut = GOOD.slice(0, GOOD.indexOf("</script>") + 9);
  const r = validateApp(cut);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.level === "error" && /未闭合/.test(i.msg)));
});

test("script 标签不配对被抓出来", () => {
  const broken = GOOD.replace("</script>", "");
  const r = validateApp(broken);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /script> 标签不配对/.test(i.msg)));
});

test("外链资源与 alert 只算建议，不影响通过", () => {
  const withCdn = GOOD.replace(
    "<title>示例应用</title>",
    '<title>示例应用</title><script src="https://cdn.example.com/a.js"></script>',
  );
  const r = validateApp(withCdn);
  assert.equal(r.ok, true);
  assert.ok(r.issues.some((i) => i.level === "warn" && /外部资源/.test(i.msg)));
});

test("空内容直接失败", () => {
  const r = validateApp("");
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /过短/.test(i.msg)));
});
