/**
 * 用 server/.venv 里的 Python 执行命令（跨平台），避免误用系统 python —— 系统 python 里没有 fastapi/pytest。
 *
 * 用法：
 *   node scripts/py.mjs -m pytest -q server
 *   node scripts/py.mjs -m uvicorn agent.main:app --app-dir server --port 8100
 *   node scripts/py.mjs packages/contract/check_contract.py http://127.0.0.1:8100
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const venvPy = path.join(root, "server", ".venv", win ? "Scripts/python.exe" : "bin/python");

if (!fs.existsSync(venvPy)) {
  console.error("找不到 server/.venv，先建虚拟环境：");
  console.error("  cd server && uv venv .venv && uv pip install -r requirements.txt");
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(venvPy, args, { cwd: root, stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
