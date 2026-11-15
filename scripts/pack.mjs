/**
 * 把 .next/standalone 补齐成可直接部署的目录（ECS/阿里云）
 * 用法：node scripts/pack.mjs
 * 产物：dist/atoms-demo/  （传服务器后 node server.js 即可）
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const stand = path.join(root, ".next", "standalone");
const out = path.join(root, "dist", "atoms-demo");

if (!fs.existsSync(path.join(stand, "server.js"))) {
  console.error("缺少 .next/standalone/server.js，请先 npm run build");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(stand, out, { recursive: true });

// 兜底：standalone 里可能残留上一轮的产物/数据（见 next.config 的 outputFileTracingExcludes）
for (const junk of ["dist", "data", "scripts"]) {
  fs.rmSync(path.join(out, junk), { recursive: true, force: true });
}

// Turbopack 的 standalone 追踪会漏掉部分 app-route runtime（实测缺
// app-route-turbo.runtime.prod.js 导致 /api/* 全部 500），这里把 next-server 运行时补全（跳过 sourcemap）
const nsSrc = path.join(root, "node_modules", "next", "dist", "compiled", "next-server");
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
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
}

// 运行期需要的说明与模板（不含任何密钥）
fs.copyFileSync(path.join(root, ".env.example"), path.join(out, ".env.example"));
// 把 ECS 一键安装脚本一起带上，服务器上只需要这一个 zip
fs.copyFileSync(path.join(root, "scripts", "install-ecs.sh"), path.join(out, "install-ecs.sh"));
fs.writeFileSync(
  path.join(out, "START-HERE.txt"),
  [
    "Atoms Demo - 独立运行包",
    "",
    "1) 需要 Node.js >= 22.5（本包用 node:sqlite 做持久化）",
    "2) 一键安装（root）： bash install-ecs.sh /opt/atoms-demo.zip --with-nginx",
    "   或手动：cp .env.example .env && nano .env（填 DEEPSEEK_API_KEY）",
    "           PORT=3000 DATA_DIR=./data node server.js",
    "3) 浏览器打开 http://<服务器IP>:3000",
    "",
    "数据落在 DATA_DIR（默认 ./data/atoms.db），重启不丢。",
    "无密钥也能跑：自动进入离线演示模式。",
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
];
const missing = must.filter((m) => !fs.existsSync(path.join(out, m)));
if (missing.length) {
  console.error("✗ 打包自检失败，缺少：", missing);
  process.exit(1);
}

console.log(`✓ 打包完成: ${out}`);
console.log(`  体积: ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
