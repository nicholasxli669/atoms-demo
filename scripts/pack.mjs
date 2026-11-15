/**
 * 大仓部署打包：Web(standalone) + Python Agent + 一键安装脚本 → dist/atoms-demo
 *
 * 用法：node scripts/pack.mjs        （先 npm --prefix apps/studio run build）
 * 产物：dist/atoms-demo/
 *   ├── server.js .next node_modules public   ← Next standalone（含 /api 路由）
 *   ├── agent/                                ← Python Agent 源码 + requirements
 *   ├── contract/                             ← 事件契约与自检脚本
 *   ├── install-ecs.sh
 *   └── START-HERE.txt
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studio = path.join(root, "apps", "studio");
const agent = path.join(root, "apps", "agent");
const stand = path.join(studio, ".next", "standalone");
const out = path.join(root, "dist", "atoms-demo");

if (!fs.existsSync(path.join(stand, "server.js"))) {
  console.error("缺少 apps/studio/.next/standalone/server.js，请先 npm --prefix apps/studio run build");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(stand, out, { recursive: true });

// standalone 里可能残留上一轮的产物/数据（见 next.config 的 outputFileTracingExcludes）
for (const junk of ["dist", "data", "scripts"]) {
  fs.rmSync(path.join(out, junk), { recursive: true, force: true });
}

// Turbopack 的 standalone 追踪会漏掉部分 app-route runtime（实测缺
// app-route-turbo.runtime.prod.js 导致 /api/* 全部 500），这里把 next-server 运行时补全（跳过 sourcemap）
const nsSrc = path.join(studio, "node_modules", "next", "dist", "compiled", "next-server");
const nsOut = path.join(out, "node_modules", "next", "dist", "compiled", "next-server");
if (fs.existsSync(nsSrc)) {
  fs.mkdirSync(nsOut, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(nsSrc)) {
    if (f.endsWith(".map")) continue;
    const from = path.join(nsSrc, f);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(nsOut, f));
    n += 1;
  }
  console.log(`  补全 next-server 运行时文件: ${n} 个`);
}

// standalone 不会自动带上静态资源与 public
fs.cpSync(path.join(studio, ".next", "static"), path.join(out, ".next", "static"), {
  recursive: true,
});
if (fs.existsSync(path.join(studio, "public"))) {
  fs.cpSync(path.join(studio, "public"), path.join(out, "public"), { recursive: true });
}

// Python Agent（不带虚拟环境、缓存与本地密钥）
const skip = new Set([".venv", "__pycache__", ".pytest_cache", ".ruff_cache", ".env", "data"]);
fs.cpSync(agent, path.join(out, "agent"), {
  recursive: true,
  filter: (src) => !skip.has(path.basename(src)),
});

// 事件契约（服务器上也能跑自检）
fs.cpSync(path.join(root, "packages", "contract"), path.join(out, "contract"), { recursive: true });

// 配置模板与安装脚本
fs.copyFileSync(path.join(studio, ".env.example"), path.join(out, ".env.example"));
fs.copyFileSync(path.join(root, "scripts", "install-ecs.sh"), path.join(out, "install-ecs.sh"));

fs.writeFileSync(
  path.join(out, "START-HERE.txt"),
  [
    "Atoms Demo 大仓产物（Web + Python Agent）",
    "",
    "一键安装（root）：",
    "  bash install-ecs.sh /opt/atoms-demo.zip --with-nginx",
    "",
    "手动启动（两个服务都要起）：",
    "  1) Agent:  cd agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
    "             DEEPSEEK_API_KEY=sk-xxx .venv/bin/python -m uvicorn agent.main:app --host 127.0.0.1 --port 8100",
    "  2) Web:    cp .env.example .env   # 填 DEEPSEEK_API_KEY，并确认 AGENT_URL=http://127.0.0.1:8100",
    "             PORT=3000 DATA_DIR=./data node server.js",
    "",
    "浏览器打开 http://<服务器IP>:3000",
    "",
    "说明：",
    "- 数据落在 DATA_DIR（默认 ./data/atoms.db），重启不丢；SQLite 单写者，Web 只跑单实例。",
    "- AGENT_URL 不通时 Web 自动回落到内置流水线，所以只起 Web 也能演示（功能略少）。",
    "- 无密钥同样可跑：自动进入离线演示模式。",
  ].join("\n"),
  "utf8",
);

const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => {
    const p = path.join(dir, e.name);
    return sum + (e.isDirectory() ? size(p) : fs.statSync(p).size);
  }, 0);

// 打包自检：缺任何一个，服务器上都会表现为 500，宁可在本地就失败
const must = [
  "server.js",
  ".next/static",
  "public",
  "node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js",
  "node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",
  "agent/agent/main.py",
  "agent/requirements.txt",
  "contract/agent-events.md",
  "install-ecs.sh",
];
const missing = must.filter((m) => !fs.existsSync(path.join(out, m)));
if (missing.length) {
  console.error("✗ 打包自检失败，缺少：", missing);
  process.exit(1);
}

console.log(`✓ 打包完成: ${out}`);
console.log(`  体积: ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
