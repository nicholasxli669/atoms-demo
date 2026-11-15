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

// standalone 不会自动带上静态资源与 public
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
}

// 运行期需要的说明与模板（不含任何密钥）
fs.copyFileSync(path.join(root, ".env.example"), path.join(out, ".env.example"));
fs.writeFileSync(
  path.join(out, "START-HERE.txt"),
  [
    "Atoms Demo - 独立运行包",
    "",
    "1) 需要 Node.js >= 22.5（本包用 node:sqlite 做持久化）",
    "2) 复制 .env.example 为 .env 并填入 DEEPSEEK_API_KEY",
    "3) 启动：  PORT=3000 DATA_DIR=./data node server.js",
    "4) 浏览器打开 http://<服务器IP>:3000",
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

console.log(`✓ 打包完成: ${out}`);
console.log(`  体积: ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
