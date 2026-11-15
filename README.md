# Atoms Demo · Agent Studio

一个**可运行的 AI Agent 应用生成器**：用一句话描述需求，Agent 分阶段（规划 → 生成 → 静态校验 → 自我修复）产出一个**单文件、可直接运行、数据可持久化**的网页应用，并实时渲染在右侧预览区；之后可以多轮对话修改、回滚任意版本、导出 HTML。

> 本项目是针对 Atoms 笔试做的 Demo：不是"纯静态概念展示"，而是完整可跑的产品原型——
> 有真实交互、有服务端持久化、有延展能力（运行时报错回传 Agent 自修复）。

---

## 1. 在线体验

| 地址 | 说明 |
| --- | --- |
| `https://<your-deploy>.vercel.app` | 部署后填写（Vercel + Turso，见第 7 节） |

本地跑：见第 6 节，3 条命令即可。

---

## 2. 核心流程（Agent 流水线）

```
用户一句话需求
      │
      ▼
① 规划   chatOnce → JSON{应用名, 定位, 3~5 个可交互功能点}     ← 让"生成什么"先对齐
      │
      ▼
② 生成   chatStream → 单文件 HTML（内联 CSS/JS，零外部依赖）  ← 逐 token 流式，前端实时显示进度
      │
      ▼
③ 校验   validateApp() 纯函数静态检查：DOCTYPE/闭合标签/标签配对/
         外链、localStorage、alert() 等  ← 不通过则进入 ④
      │
      ▼
④ 自修复 最多 2 轮：把 issue 列表回传模型 → 重新生成 → 再校验
      │
      ▼
⑤ 落库   versions 表存版本 ｜ messages 表存对话与执行步骤 ｜ projects 表更新应用名
      │
      ▼
右侧 iframe 实时渲染 + 代码视图 + 控制台 + 版本回滚
```

**为什么生成"单文件 HTML"而不是 React 工程？**
1. 浏览器 `iframe srcdoc` 秒级渲染，不需要构建/沙箱进程，Demo 的"体验闭环"最短；
2. 生成物**独立可用**：导出后双击就能跑，方便评委验证"是真应用不是截图"；
3. 模型对单文件 HTML 的一次成功率明显高于多文件工程，能把 6~8 小时的预算花在 Agent 编排与体验上，而不是修构建错误。

---

## 3. 功能清单

### 基本流程
- ✅ 空状态引导 + 4 个模板一键起跑（任务看板 / 记账本 / 习惯打卡 / 客户 CRM）
- ✅ Agent 执行过程可视化：分步骤、带状态与细节（规划出的功能点、代码行数/KB、校验结果）
- ✅ 流式生成：边生成边显示字符数进度，支持中途**停止**
- ✅ 实时预览 + 设备切换（桌面/平板/手机）
- ✅ 代码视图（带行号）+ 复制导出
- ✅ **多轮对话修改**：修改模式会把当前源码回传给模型，产出新版本
- ✅ 版本历史与**任意回滚**
- ✅ 项目列表：新建/打开/删除，历史对话与版本全部从数据库恢复
- ✅ 导出单文件 HTML、一键新标签打开

### 延展能力（超出 PoC 的部分）
- 🐞 **运行时控制台回传**：注入 hook 捕获生成应用的 `console.*`、`window.onerror`、`unhandledrejection`，显示在"控制台"面板；
- 🛠 **一键「让 Agent 修复」**：把真实报错 + 源码交给模型定位修复，产出新版本（形成 agentic 闭环，而不是只生成一次）；
- 🔁 **静态校验 + 自动修复循环**：结构性问题（截断、标签不配对、外链资源）自动重试，最多 2 轮；
- 📴 **离线演示模式**：未配置 API Key 时用内置模板走同一条流水线，保证 Demo 永远能演示；
- 🗄 **双驱动持久化**：本地 SQLite ⇄ 云端 libSQL/Turso，同一套 Store 接口，本地零配置、部署零改动。

---

## 4. 技术栈与选型理由

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 框架 | Next.js 16（App Router）+ React 19 + TS | 一个仓库同时搞定页面与 API，SSE 流式直出，部署面广 |
| 样式 | 手写 CSS 变量体系（无 UI 库） | Demo 的视觉辨识度是评分项，UI 库会拖成"模板脸"；也避免构建期联网下载字体 |
| 模型 | DeepSeek `deepseek-chat`（OpenAI 兼容协议） | 中文指令遵循好、便宜、可换任意 OpenAI 兼容端点（改 `LLM_BASE_URL`/`LLM_MODEL` 即可） |
| 流式协议 | SSE（`text/event-stream`）+ 自定义事件类型 | 比 WebSocket 简单，浏览器原生支持，事件可读性好 |
| 存储 | `node:sqlite`（本地）／`@libsql/client`（云端） | 本地零依赖零编译；Serverless 环境切换成 Turso 的 8 行适配 |
| 沙箱 | `iframe sandbox="allow-scripts allow-same-origin"` + `srcdoc` | 允许生成物用 localStorage 做持久化；同时注入了 console hook |

---

## 5. 架构

```
src/
├─ app/
│  ├─ page.tsx                  # 单页工作台
│  ├─ globals.css               # 设计系统（暗色）+ 响应式
│  └─ api/
│     ├─ health/route.ts        # 运行模式探测（live / demo、存储驱动）
│     ├─ projects/route.ts      # 列表 / 新建
│     ├─ projects/[id]/route.ts # 详情（消息+版本）/ 重命名 / 删除
│     └─ generate/route.ts      # ★ Agent 流水线，SSE 流式输出
├─ components/
│  ├─ Studio.tsx                # 状态编排、SSE 解析、事件 → UI
│  ├─ Sidebar.tsx  Composer.tsx  AgentCard.tsx
│  ├─ PreviewPanel.tsx          # 预览 / 代码 / 控制台 / 版本
│  └─ icons.tsx
└─ lib/
   ├─ llm.ts        # OpenAI 兼容客户端（流式 + 一次性）
   ├─ prompts.ts    # 规划 / 生成 / 修改 / 修复 提示词 + JSON 兜底解析
   ├─ validate.ts   # 生成代码静态校验（纯函数）
   ├─ instrument.ts # 注入沙箱的 console/error hook
   ├─ store.ts      # 存储接口 + sqlite/libsql 双驱动
   ├─ demoTemplates.ts # 离线演示用内置应用
   └─ types.ts
```

**数据模型**（3 张表，`projects` / `messages` / `versions`）
- 消息里额外存了 `steps`（Agent 执行轨迹）与 `plan`（规划结果）的 JSON —— 所以刷新页面后，历史对话里的执行过程依然可以还原；
- 版本是**不可变快照**，回滚只是切换 `activeVersionId` 重新渲染，不覆盖历史。

---

## 6. 本地运行

```bash
npm install
cp .env.example .env.local     # 填入 DEEPSEEK_API_KEY（不填则进离线演示模式）
npm run dev                    # http://localhost:3000
```

验证脚本（会真实调用模型，跑完整链路：建项目 → 生成 → 修改 → 落库校验）：

```bash
node scripts/verify.mjs            # 服务端 E2E：生成 + 增量修改 + 持久化
node scripts/shot.mjs              # 浏览器 E2E：点模板 → 等生成 → 进 iframe 里真交互 → 截图
node scripts/audit.mjs             # 布局审计 + 控制台回传 + 一键修复闭环 + 刷新恢复
```

（`shot` / `audit` 用 `puppeteer-core` 驱动系统自带 Edge，不下载 Chromium，截图输出到 `scripts/.shots/`）

构建：

```bash
npm run build && npm start
```

### 实测记录（本机 Windows 11 / i7-13700KF / Node 24 / deepseek-chat）

| 场景 | 结果 |
| --- | --- |
| 首轮生成「习惯打卡工具」 | 17.4s / 491 行 / 16.3 KB，静态校验 0 条问题 |
| 首轮生成「团队任务看板」 | 19s / 590 行 / 22.1 KB，`localStorage` 已接入 |
| 增量修改「改成绿色主题 + 加今日日期」 | 产出 v2，保留历史版本 |
| 控制台报错 → 一键修复 | 36.4s 产出新版本，步骤显示「根据控制台报错定位问题 — 已重写并消除报错」 |
| 浏览器内真实操作生成的应用 | 提交表单后 `localStorage` 写入 741 字节，刷新仍在 |
| 页面 JS 错误 | 0 |
| 布局 | 1440px 三栏 252/517/671 无横向滚动；390px 单栏 + 底部切换器无横向滚动 |


---

## 7. 部署（可测试在线链接）

Vercel 的 Serverless 文件系统只读，本地 SQLite 不适用，接 Turso（libSQL，免费额度足够）。**代码零改动**：`store.ts` 只要检测到 `TURSO_DATABASE_URL` 就自动切到 libSQL 驱动。

### 7.1 建库（Turso）

方式 A：网页控制台 <https://turso.tech> → 新建 database → 复制 `libsql://…` 地址与 token。

方式 B：命令行（Windows PowerShell）

```powershell
irm https://get.tur.so/install.ps1 | iex
turso auth signup
turso db create atoms-demo
turso db show atoms-demo --url          # → TURSO_DATABASE_URL
turso db tokens create atoms-demo       # → TURSO_AUTH_TOKEN
```

### 7.2 部署（Vercel）

```powershell
npm i -g vercel
vercel login          # 邮箱登录即可
vercel link           # 关联到新项目 atoms-demo
vercel env add DEEPSEEK_API_KEY production
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel --prod
```

部署后先打开 `/api/health` 自检，应返回：

```json
{ "ok": true, "mode": "live", "model": "deepseek-chat", "store": "libsql:remote", "persistent": true }
```

- `mode` 为 `live` 表示模型已接通（否则是离线演示模式）；`persistent: true` 表示接的是远端库，重启不丢数据。
- `generate` 路由已声明 `maxDuration = 300`：单次生成 15~40s，Vercel Fluid Compute 下 Hobby 计划上限即 300s，够用；若换成 60s 上限的平台，需要把生成长度压到 300 行以内或改成分段续写。


---

## 8. 已知取舍 / 下一步

| 取舍 | 说明 | 下一步 |
| --- | --- | --- |
| 生成物是单文件 HTML | 追求"秒级可跑 + 可导出"，牺牲了多文件工程能力 | 演进为"文件树 + diff 应用"，在 WebContainer 里跑真正的 React/Next 工程 |
| 沙箱同源 | `allow-same-origin` 让 localStorage 可用，但生成物与宿主同源 | 生产环境用独立域名 + CSP 隔离，或 Web Worker/WebContainer 执行 |
| 修复循环最多 2 轮 | 控制成本与延迟，避免无限重试 | 引入"评估器 Agent"打分 + 按需多轮，或加视觉回归截图比对 |
| 无登录 | 题目不作要求，单个实例共享一个工作区 | 加用户/租户维度，`projects` 挂 `owner_id` |
| 单轮对话上下文只带当前版本源码 | 简单、可控 | 加检索式上下文（历史需求摘要），支持"回到 v2 但保留 v4 的配色" |

---

## 9. 如果只有 6~8 小时，为什么是这些取舍

1. **先做闭环，再做广度**：一条"输入 → 可视化结果 → 可交互 → 数据不丢"的主线，比十个半成品功能更能说明产品能力；
2. **把不确定性留在模型侧、确定性留在本地**：静态校验是纯函数、可单测，模型抽风时能被拦下并自修复——这是 Demo 能被评委"随便点"的前提；
3. **延展能力选"闭环型"而不是"堆功能型"**：控制台报错 → Agent 修复，一个功能就展示了"Agent 能持续工作"，而不是一次性生成器。
