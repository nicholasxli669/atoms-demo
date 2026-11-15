"""Agent 主循环：规划 → 生成 → 静态校验 → 自动修复 → 截断续写。

以 async generator 的形式吐事件，HTTP 层只负责把事件序列化成 SSE。
这样这条流水线在单测里可以直接调用（传一个假 LLM），不需要起服务。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .llm import LLM
from .prompts import (
    code_messages,
    continue_messages,
    edit_messages,
    guess_name,
    parse_plan,
    plan_messages,
    repair_messages,
)
from .validate import extract_html, looks_truncated, validate_app

MAX_REPAIR_ROUNDS = 2
MAX_CONTINUE_ROUNDS = 2
DELTA_EVERY = 120


@dataclass
class RunRequest:
    message: str
    mode: str = "new"  # new | edit
    base_code: str = ""
    app_name: str = ""
    runtime_logs: list[str] = field(default_factory=list)


Event = dict[str, Any]


def _step(key: str, label: str, status: str, detail: str | None = None) -> Event:
    ev: Event = {"t": "step", "key": key, "label": label, "status": status}
    if detail:
        ev["detail"] = detail
    return ev


async def run_pipeline(req: RunRequest, llm: LLM) -> AsyncIterator[Event]:
    if not req.message.strip():
        yield {"t": "error", "message": "message 不能为空"}
        return
    if not llm.ready:
        yield {"t": "error", "message": "Agent 未配置模型密钥（DEEPSEEK_API_KEY）"}
        return

    yield {"t": "start", "runId": str(int(time.time() * 1000))}

    # 1) 规划
    if req.mode == "edit":
        plan: dict[str, Any] = {
            "name": req.app_name or "已有应用",
            "summary": "在已有应用上继续修改",
            "features": [],
        }
    else:
        yield _step("plan", "产品经理 · 拆解需求并定方案", "run")
        try:
            raw = await llm.once(plan_messages(req.message), max_tokens=420, temperature=0.4)
            plan = parse_plan(raw, guess_name(req.message))
            detail = (
                f"{plan['name']} · " + " / ".join(plan["features"])
                if plan["features"]
                else (plan["summary"] or "已确定实现范围")
            )
            yield _step("plan", "产品经理 · 拆解需求并定方案", "ok", detail)
        except Exception as exc:  # noqa: BLE001 - 规划失败不该阻断生成
            plan = {"name": guess_name(req.message), "summary": "", "features": []}
            yield _step("plan", "产品经理 · 拆解需求并定方案", "err", str(exc)[:160])
    yield {"t": "plan", "plan": plan}

    # 2) 生成代码
    gen_label = "工程师 · 按新要求改写" if req.mode == "edit" else "工程师 · 编写界面与交互"
    yield _step("code", gen_label, "run")

    messages = (
        edit_messages(req.message, req.base_code)
        if req.mode == "edit"
        else code_messages(req.message, plan)
    )
    code = ""
    sent = 0
    async for piece in llm.stream(messages, max_tokens=8000, temperature=0.3):
        code += piece
        if len(code) - sent > DELTA_EVERY:
            sent = len(code)
            yield {"t": "delta", "chars": len(code)}

    code = extract_html(code)
    yield _step(
        "code",
        gen_label,
        "ok",
        f"{code.count(chr(10)) + 1} 行 · {len(code.encode('utf-8')) / 1024:.1f} KB",
    )

    # 3) 运行时控制台报错修复（编辑模式下用户把浏览器报错回传时）
    if req.mode == "edit" and req.runtime_logs:
        yield _step("repair", "工程师 · 按控制台报错定位修复", "run")
        base = validate_app(code)
        issues = [{"level": i.level, "msg": i.msg} for i in base.issues]
        issues += [
            {"level": "error", "msg": f"运行时报错：{line}"} for line in req.runtime_logs[:8]
        ]
        code = await _repair_once(code, issues, req.runtime_logs, llm)
        after = validate_app(code)
        yield _step(
            "repair",
            "工程师 · 按控制台报错定位修复",
            "ok" if after.ok else "err",
            "已重写并消除报错" if after.ok else "仍有问题，建议继续对话修正",
        )

    # 4) 静态校验 + 自动修复
    result = validate_app(code)
    yield _step(
        "validate",
        "QA · 静态校验",
        "ok" if result.ok else "err",
        (
            f"{result.stats.lines} 行 · localStorage "
            f"{'已接入' if result.stats.has_storage else '未使用'} · {len(result.issues)} 条建议"
            if result.ok
            else "；".join(result.errors())
        ),
    )
    yield _validate_event(result)

    rounds = 0
    while not result.ok and rounds < MAX_REPAIR_ROUNDS:
        rounds += 1
        label = f"工程师 · 自动修复第 {rounds} 轮"
        yield _step(f"repair-{rounds}", label, "run")
        issues = [{"level": i.level, "msg": i.msg} for i in result.issues]
        code = await _repair_once(code, issues, req.runtime_logs, llm)
        result = validate_app(code)
        yield _step(
            f"repair-{rounds}",
            label,
            "ok" if result.ok else "err",
            "校验通过" if result.ok else "；".join(result.errors()),
        )
        yield _validate_event(result)

    # 5) 截断恢复：长文件会撞上模型单次输出上限（约 8k tokens），特征是压根没有 </html>
    cont = 0
    while not result.ok and looks_truncated(code) and cont < MAX_CONTINUE_ROUNDS:
        cont += 1
        label = f"工程师 · 续写被截断的尾部（第 {cont} 次）"
        yield _step(f"continue-{cont}", label, "run")
        more = ""
        async for piece in llm.stream(
            continue_messages(code[-4000:]), max_tokens=8000, temperature=0.15
        ):
            more += piece
            yield {"t": "delta", "chars": len(code) + len(more)}
        code = extract_html(code + more)
        result = validate_app(code)
        yield _step(
            f"continue-{cont}",
            label,
            "ok" if result.ok else "err",
            f"{result.stats.lines} 行 · 续写后已闭环" if result.ok else "；".join(result.errors()),
        )
        yield _validate_event(result)

    yield {
        "t": "final",
        "code": code,
        "plan": plan,
        "mode": req.mode,
        "ok": result.ok,
        "issues": [{"level": i.level, "msg": i.msg} for i in result.issues],
        "stats": {
            "lines": result.stats.lines,
            "bytes": result.stats.bytes,
            "hasStorage": result.stats.has_storage,
            "external": result.stats.external,
        },
    }


def _validate_event(result) -> Event:
    return {
        "t": "validate",
        "ok": result.ok,
        "issues": [{"level": i.level, "msg": i.msg} for i in result.issues],
    }


async def _repair_once(
    code: str, issues: list[dict[str, str]], runtime_logs: list[str] | None, llm: LLM
) -> str:
    """让模型按问题清单重写一版；失败就返回原稿，不让整条链路崩掉。"""
    out = ""
    try:
        async for piece in llm.stream(
            repair_messages(code, issues, runtime_logs), max_tokens=8000, temperature=0.2
        ):
            out += piece
    except Exception:  # noqa: BLE001 - 修复失败降级为原稿
        return code
    fixed = extract_html(out)
    return fixed if len(fixed) > 500 else code
