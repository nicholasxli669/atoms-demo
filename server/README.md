# server · Atoms Agent（Python / FastAPI）

把"一句话需求 → 可运行单文件应用"的 Agent 循环独立成服务。**无状态**：不碰数据库、不落文件，只吐事件。

## 运行

```powershell
uv venv .venv
uv pip install -r requirements.txt
copy .env.example .env                  # DEEPSEEK_API_KEY / LLM_BASE_URL / LLM_MODEL / AGENT_PORT
.venv\Scripts\python -m uvicorn agent.main:app --port 8100
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ok, service, version, model, mode, ready}`；`ready=false` 时 client 会回落内置流水线 |
| POST | `/v1/run` | SSE 流：`start → step/plan/delta → validate → final`（契约见 `packages/contract/agent-events.md`） |

## 代码结构

```
server/                   # 本目录 = 大仓里的 server 端
├── agent/
│   ├── main.py           FastAPI + SSE（只做协议转换）
│   ├── pipeline.py       规划 → 生成 → 校验 → 修复 → 续写（async generator，可单测）
│   ├── prompts.py        提示词（与 client/src/lib/prompts.ts 对齐）
│   ├── validate.py       静态校验（与 TS 版同一套判据）
│   ├── llm.py            OpenAI 兼容流式客户端（httpx）
│   └── config.py         环境变量
├── tests/                11 个用例（假 LLM，无网络）
├── requirements.txt
└── pyproject.toml        pytest 配置
```

## 测试

```powershell
.venv\Scripts\python -m pytest -q          # 11 个用例
```

覆盖：校验器判据、截断判定、完整事件序列、续写恢复、控制台报错修复路径、缺密钥降级。
