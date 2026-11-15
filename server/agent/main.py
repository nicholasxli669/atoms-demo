"""HTTP 入口：把 Agent 流水线以 SSE 暴露出去。

约定（详见 packages/contract/agent-events.md）：
- 本服务只负责“想 + 写 + 自检”，不碰数据库；
- 事件序列为 start → step/plan/delta → validate → final，落库与 version/summary 由 Web 端负责。
"""

from __future__ import annotations

import json
from typing import AsyncIterator, Literal

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .config import load_settings
from .llm import LLM
from .pipeline import Event, RunRequest, run_pipeline

settings = load_settings()
llm = LLM(settings)

app = FastAPI(title="Atoms Agent", version=__version__)


class RunBody(BaseModel):
    message: str = Field(min_length=1)
    mode: Literal["new", "edit"] = "new"
    projectId: str | None = None
    baseCode: str | None = None
    appName: str | None = None
    runtimeLogs: list[str] | None = None


def sse(event: Event) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "atoms-agent",
        "version": __version__,
        "model": settings.model,
        "mode": "live" if settings.ready else "demo",
        "ready": settings.ready,
    }


@app.post("/v1/run")
async def run(body: RunBody) -> StreamingResponse:
    req = RunRequest(
        message=body.message.strip(),
        mode=body.mode,
        base_code=body.baseCode or "",
        app_name=body.appName or "",
        runtime_logs=body.runtimeLogs or [],
    )

    async def gen() -> AsyncIterator[str]:
        try:
            async for event in run_pipeline(req, llm):
                yield sse(event)
        except Exception as exc:  # noqa: BLE001 - 任何异常都转成事件，不留半截连接
            yield sse({"t": "error", "message": str(exc)[:400]})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("agent.main:app", host="127.0.0.1", port=settings.port, reload=False)
