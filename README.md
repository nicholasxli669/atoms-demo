# Atoms Studio · 大仓（Web + Python Agent）

一句话需求 → Agent 分阶段规划、流式生成单文件 Web 应用 → 静态校验 → 失败自动修复 / 截断续写 → 工作台实时预览、版本回滚、控制台报错一键回传修复。

**动手前先看这两条**：无 API Key 也能完整演示（自动进入离线演示模式）；只起 Web 也能跑（自动回落内置流水线）。

## 大仓结构

```
atoms-demo/
├── apps/
│   ├── studio/                # Next.js 16 工作台（UI + 状态 + 持久化 + SSE 入口）
│   │   ├── src/app/api/generate/route.ts    # 唯一对浏览器开放的生成接口（SSE）
│   │   ├── src/lib/store.ts                 # node:sqlite ⇄ libSQL(Turso) 双驱动
│   │   ├── src/lib/agentClient.ts           # 调 Python Agent 的客户端（AGENT_URL）
│   │   └── tests/ · scripts/                # 单测 / E2E / 审计脚本
│   └── agent/                 # Python Agent 服务（FastAPI，只负责"想+写+自检"）
│       ├── agent/pipeline.py  # 规划 → 生成 → 校验 → 修复 → 续写（async generator）
│       ├── agent/validate.py  # 与 TS 版同一套判据
│       └── tests/             # 假 LLM 跑完整事件序列，不花钱
├── packages/contract/         # 两个服务共同遵守的事件契约 + 契约自检脚本
├── docs/                      # 部署文档
└── scripts/                   # 打包与一键部署（跨服务）
```

职责边界：**Agent 无状态**（不碰数据库、不落文件），只吐事件；**Web 负责落库**与对浏览器的事件协议。契约见 [`packages/contract/agent-events.md`](packages/contract/agent-events.md)。

## 快速开始

```powershell
# 1) Agent（Python 3.11+）
cd apps\agent
uv venv .venv                       # 或 python -m venv .venv
uv pip install -r requirements.txt
copy .env.example .env              # 填 DEEPSEEK_API_KEY（不填 = demo 模式）
.venv\Scripts\python -m uvicorn agent.main:app --port 8100

# 2) Web（Node >= 22，本机用的是 24）
cd apps\studio
npm install
copy .env.example .env.local        # 填 DEEPSEEK_API_KEY；AGENT_URL=http://127.0.0.1:8100
npm run dev -- --port 3210
```

打开 http://localhost:3210 。`/api/health` 会告诉你当前是 `live` 还是 `demo`、数据库驱动、是否持久化。

**AGENT_URL 的行为**：填了且 Agent `/health` 的 `ready=true` → 走 Python 服务；否则（没起服务 / 没密钥 / 超时 1.5s）→ 自动回落 Next 内置流水线，页面行为不变。

根目录也有一组便捷脚本：`npm run dev`、`npm run build`、`npm test`、`npm run test:agent`、`npm run contract`（需先起 Agent）。

## Agent 做了什么（不是"一次调模型"）

| 阶段 | 内容 | 可观测产物 |
|---|---|---|
| 产品经理 | 把一句话需求拆成应用名 / 定位 / 3~5 个功能点 | `plan` 事件 + 步骤明细 |
| 工程师 | 流式生成单文件 HTML（内联 CSS/JS、零外部依赖、localStorage 持久化） | `delta` 进度、行数/KB |
| QA | 纯函数静态校验：DOCTYPE/闭合/标签配对/外链/alert/localStorage | `validate` 事件 + 问题清单 |
| 工程师 · 修复 | 按问题清单重写完整文件，最多 2 轮 | 每轮 `step` 状态 |
| 工程师 · 续写 | 撞上模型单次输出上限（约 8k tokens）时，从断点续写并拼接，最多 2 次 | 「续写被截断的尾部」步骤 |
| 工作区 | 存版本、改项目名、写汇总消息 | `version` / `summary` 事件 |

浏览器端额外获得的能力：代码/预览/控制台/版本四视图、版本回滚、导出与复制、中途停止、
**控制台报错 → 一键让 Agent 修复**（把真实堆栈回传给 Agent 跑修复轮）。

## 验证（都是实跑过的）

```bash
cd apps/studio
npm test                    # 10 个单测：校验器 / 截断判定 / 汇总文案（node:test，~80ms）
npm run lint                # eslint 0 error / 0 warning
npm run build               # Next 16 standalone，6 条路由
node scripts/verify.mjs http://localhost:3210    # 服务端 E2E：生成 + 增量修改 + 落库校验
node scripts/audit.mjs     http://localhost:3210 # 布局审计 + 控制台回传修复闭环
node scripts/shot.mjs      http://localhost:3210 # 浏览器 E2E + 截图（系统 Edge）

cd apps/agent
.venv/Scripts/python -m pytest -q                # 11 个单测：校验器 + 完整事件序列（假 LLM）
cd ../../ && python packages/contract/check_contract.py http://127.0.0.1:8100   # 契约自检
```

最近一次实测（真实模型调用）：

| 场景 | 结果 |
|---|---|
| 契约自检（Python Agent） | 598 行 / 15.4 KB / 16.3s / 事件序列合规 |
| Web→Agent 全链路（打包产物） | 首轮 18s、增量修改产出 v2、4 条消息 / 2 个版本落库 |
| Web 内置流水线（不依赖 Agent） | 496 行 / 17.5 KB / 18.6s，校验 0 问题 |
| 单测 | studio 10/10、agent 11/11 |

## 部署（阿里云 ECS）

```bash
# 本地打包（Web standalone + Agent + 安装脚本）
npm --prefix apps/studio run build
node scripts/pack.mjs                     # → dist/atoms-demo（含 agent/、contract/、install-ecs.sh）

# 上传后（服务器上一条命令，装 Node 24 + python3-venv + 两个 systemd 服务 + 可选 Nginx）
bash install-ecs.sh /opt/atoms-demo.zip --with-nginx
```

细节见 [`docs/aliyun-ecs.md`](docs/aliyun-ecs.md)（含 SSE 反代必须 `proxy_buffering off`、安全组放行、数据目录独立于代码目录）。

为什么不用函数计算 FC / Vercel 直接跑 Web：`node:sqlite` 需要持久磁盘，Serverless 上要换 Turso（Web 侧已支持，`TURSO_DATABASE_URL` 走 libSQL 驱动），但 Python Agent 是长连接 SSE，更适合常驻进程。

## 已知边界

- 生成物是**单文件 HTML**（不是 React 工程）：为的是 iframe 秒级预览、可导出、模型输出稳定；要生成工程需引入构建沙箱与预览编译。
- 每轮修改是**整文件重写**而非 diff，文件越大越吃 token；>900 行会频繁触发续写兜底。
- Agent 不读历史对话，只用「当前源码 + 这条指令」；"改回去"请用版本回滚。
- SQLite 单写者：Web 只能单实例，不能多副本共享同一个 `data/` 目录。
- 没有 prompt 注入防护（沙箱 iframe 已限制能力），正式产品还需输出白名单 + CSP。
