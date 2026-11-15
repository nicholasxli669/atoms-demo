"""契约自检：验证 Agent 服务吐出的 SSE 事件是否符合 packages/contract/agent-events.md。

用法：
    .venv/Scripts/python.exe ../../packages/contract/check_contract.py http://127.0.0.1:8100
退出码 0 = 契约通过；1 = 违约（会打印哪一条不对）。
"""

from __future__ import annotations

import json
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"

REQUIRED: dict[str, set[str]] = {
    "start": {"runId"},
    "step": {"key", "label", "status"},
    "plan": {"plan"},
    "delta": {"chars"},
    "validate": {"ok", "issues"},
    "final": {"code", "plan", "ok", "stats"},
    "error": {"message"},
}
ALLOWED_STATUS = {"run", "ok", "err", "skip"}


def fail(msg: str) -> None:
    print(f"✖ 契约违约：{msg}")
    sys.exit(1)


def main() -> None:
    health = httpx.get(f"{BASE}/health", timeout=10).json()
    print("health:", json.dumps(health, ensure_ascii=False))

    body = {
        "message": "做一个记录每日饮水的小工具，能加减杯数并显示今日总量",
        "mode": "new",
    }
    started = time.time()
    events: list[dict] = []

    with httpx.stream("POST", f"{BASE}/v1/run", json=body, timeout=300) as res:
        if res.status_code != 200:
            fail(f"HTTP {res.status_code}")
        if "text/event-stream" not in res.headers.get("content-type", ""):
            fail("Content-Type 不是 text/event-stream")
        for line in res.iter_lines():
            if not line.startswith("data:"):
                continue
            events.append(json.loads(line[5:].strip()))

    if not events:
        fail("没有任何事件")

    # 1) 事件名与必填字段
    for i, ev in enumerate(events):
        kind = ev.get("t")
        if kind not in REQUIRED:
            fail(f"第 {i} 个事件类型未知：{kind}")
        missing = REQUIRED[kind] - set(ev)
        if missing:
            fail(f"第 {i} 个 {kind} 事件缺字段：{sorted(missing)}")
        if kind == "step" and ev["status"] not in ALLOWED_STATUS:
            fail(f"step 状态非法：{ev['status']}")

    # 2) 顺序约束
    kinds = [e["t"] for e in events]
    if kinds[0] != "start":
        fail(f"首个事件必须是 start，实际是 {kinds[0]}")
    if kinds[-1] != "final":
        fail(f"最后一个事件必须是 final，实际是 {kinds[-1]}")
    if "plan" not in kinds:
        fail("缺少 plan 事件")
    if kinds.count("final") != 1:
        fail("final 事件必须且只能出现一次")

    final = events[-1]
    if not isinstance(final["code"], str) or len(final["code"]) < 500:
        fail("final.code 过短，可能没拿到完整源码")
    if final["ok"] and not final["code"].rstrip().endswith("</html>"):
        fail("final.ok 为真但源码没有 </html> 收尾")

    steps = [e for e in events if e["t"] == "step"]
    deltas = [e for e in events if e["t"] == "delta"]
    elapsed = time.time() - started

    print("\n事件序列:", " → ".join(kinds))
    print(f"步骤 {len(steps)} 个 / delta {len(deltas)} 个 / 总事件 {len(events)} 个")
    for s in steps:
        print(f"  [{s['status']:4}] {s['label']}" + (f" — {s.get('detail', '')}" if s.get("detail") else ""))
    print(
        f"\nfinal: ok={final['ok']} · {final['stats']['lines']} 行 · "
        f"{final['stats']['bytes'] / 1024:.1f} KB · 耗时 {elapsed:.1f}s"
    )
    print(f"应用名: {final['plan']['name']}")
    print("✔ 契约通过")


if __name__ == "__main__":
    main()
