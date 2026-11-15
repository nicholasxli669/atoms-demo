# Agent 服务事件契约（v1）

两端共同遵守这一份契约：**client/（Next.js）** 负责产品与状态，**server/（Python Agent）** 负责"想 + 写 + 自检"。

```
浏览器 ──POST /api/generate(SSE)──▶ client/Next.js ──POST /v1/run(SSE)──▶ server/Python Agent
                                      │                                        │
                                      │◀── start/step/plan/delta/validate/final ┘
                                      ├─ 落库（projects/messages/versions）
                                      └─▶ 浏览器可见事件（多了 version/summary/end）
```

## 1. Web → Agent

`POST {AGENT_URL}/v1/run`，`Content-Type: application/json`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | ✓ | 用户这句话（新建需求或修改指令） |
| `mode` | `"new"` \| `"edit"` | | 默认 `new`；`edit` 时进入增量修改 |
| `baseCode` | string | | `edit` 时传入的当前源码（超过 200 字符才用） |
| `appName` | string | | `edit` 时用于保持应用名 |
| `runtimeLogs` | string[] | | 浏览器控制台报错，会作为修复上下文 |

`GET {AGENT_URL}/health` → `{ ok, service, version, model, mode: "live"|"demo", ready }`
client 只在 `ok=true 且 ready=true` 时走 server；否则回落到自身内置流水线（无密钥也能演示）。

## 2. server → client 事件（SSE，`data: {json}\n\n`）

| `t` | 载荷 | 说明 |
|---|---|---|
| `start` | `runId: string` | 一次运行的开始 |
| `step` | `key, label, status, detail?` | `status ∈ run \| ok \| err \| skip` |
| `plan` | `plan: {name, summary, features[]}` | 方案确定 |
| `delta` | `chars: number` | **只发进度（字符数），不传正文**，避免大文件反复序列化 |
| `validate` | `ok: boolean, issues: {level, msg}[]` | 每次校验后都会发 |
| `final` | `code, plan, mode, ok, issues[], stats{lines,bytes,hasStorage,external}` | **必定是最后一条**；client 用它落库 |
| `error` | `message: string` | 允许中途出现；出现后仍会有 `final` 或连接结束 |

约束（`packages/contract/check_contract.py` 会逐条检查）：

1. 首事件必须是 `start`；正常跑完以 `final` 收尾，异常/取消以 `error` 收尾（不允许无终止地断开）
2. `final` 必须且只能出现一次
3. `final.ok = true` 时 `code` 必须以 `</html>` 结尾且 ≥ 500 字节
4. server **不发送** `version / report / summary / end`——这些由 client 生成
5. server 无状态：不写数据库、不存文件

## 3. client → 浏览器事件

沿用原有客户端协议：server 的事件原样透传（`start/step/plan/delta/validate/error`），
末尾由 client 追加 `version`（落库后的版本对象）、`report`（质量验收报告：7 项静态判据 + 修复/续写次数）、
`summary`（人话总结）、`end`。注意 `report` 由 client 用**它自己的**校验器算，所以 TS 侧规则是唯一判据来源。

## 4. 判据必须一致

`validate` 的规则在两端各实现一份（TypeScript 与 Python），改规则时必须两边同时改：

- 错误：输出 < 500 字节、缺 `<!doctype>/<html>`、缺 `</html>`、缺 `<body>`、`<script>`/`<style>` 标签不配对
- 建议：无样式表、无脚本、无 localStorage、引用外部资源、使用 `alert()/prompt()`

单测：`client/tests/validate.test.ts` ↔ `server/tests/test_validate.py`（同一组用例）
