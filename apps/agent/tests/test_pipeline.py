"""流水线单测：用假 LLM 跑完整事件序列，不花一分钱模型调用。"""

from __future__ import annotations

from typing import AsyncIterator

from agent.pipeline import RunRequest, run_pipeline
from agent.validate import extract_html

GOOD = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>待办</title>
<style>body{margin:0;background:#111;color:#eee;font-family:system-ui}
.card{padding:16px;border-radius:12px;background:#1c1c1c;margin:16px}
button{padding:8px 14px;border:0;border-radius:8px;background:#4f46e5;color:#fff}</style></head>
<body><main class="card"><ul id="list"></ul><button id="add">添加</button></main>
<script>
const KEY = "app:todo";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? [{ id: 1, text: "示例" }]; } catch { return []; } };
const save = (v) => localStorage.setItem(KEY, JSON.stringify(v));
document.getElementById("add").onclick = () => { const v = read(); v.push({ id: Date.now(), text: "新任务" }); save(v); };
save(read());
</script></body></html>"""

PLAN_JSON = (
    '{"name":"极简待办","summary":"记录每天要做的事",'
    '"features":["添加任务","勾选完成","本地保存"]}'
)


class FakeLLM:
    """按调用顺序返回预设内容：once 一次规划，stream 依次返回队列里的片段。"""

    def __init__(self, streams: list[list[str]], plan: str = PLAN_JSON) -> None:
        self.ready = True
        self._plan = plan
        self._streams = list(streams)
        self.calls = 0

    async def once(self, messages, max_tokens=512, temperature=0.35) -> str:  # noqa: ANN001
        return self._plan

    async def stream(self, messages, max_tokens=8000, temperature=0.3) -> AsyncIterator[str]:  # noqa: ANN001
        self.calls += 1
        chunks = self._streams.pop(0) if self._streams else []
        for c in chunks:
            yield c


async def collect(req: RunRequest, llm) -> list[dict]:  # noqa: ANN001
    return [ev async for ev in run_pipeline(req, llm)]


async def test_new_mode_event_sequence_and_final_code():
    llm = FakeLLM([[GOOD[i : i + 400] for i in range(0, len(GOOD), 400)]])
    events = await collect(RunRequest(message="做一个待办清单"), llm)

    kinds = [e["t"] for e in events]
    assert kinds[0] == "start"
    assert "plan" in kinds and "delta" in kinds and "validate" in kinds
    assert kinds[-1] == "final"

    plan_ev = next(e for e in events if e["t"] == "plan")
    assert plan_ev["plan"]["name"] == "极简待办"
    assert len(plan_ev["plan"]["features"]) == 3

    final = events[-1]
    assert final["ok"] is True
    assert final["code"].startswith("<!DOCTYPE html>")
    assert final["code"].endswith("</html>")
    assert final["stats"]["hasStorage"] is True


async def test_truncated_output_is_recovered_by_continuation():
    cut = GOOD[: GOOD.index("</script>") + 9]
    # 第 1 次生成被截断；2 轮修复仍返回同样截断稿；第 4 次调用是“续写”，补完尾部
    llm = FakeLLM([[cut], [cut], [cut], ["</body></html>"]])
    events = await collect(RunRequest(message="做一个待办清单"), llm)

    repair_steps = [e for e in events if e["t"] == "step" and e["key"] == "repair"]
    assert any("续写被截断的尾部" in e["label"] for e in repair_steps)
    assert any(e["status"] == "ok" and "续写" in e["label"] for e in repair_steps)

    final = events[-1]
    assert final["t"] == "final"
    assert final["ok"] is True
    assert final["code"].endswith("</html>")


async def test_runtime_logs_trigger_console_repair_step():
    llm = FakeLLM([["<html><body>broken"], [GOOD]])
    events = await collect(
        RunRequest(message="修一下", mode="edit", base_code=GOOD, runtime_logs=["TypeError: x is null"]),
        llm,
    )
    labels = [e["label"] for e in events if e["t"] == "step"]
    assert any("按控制台报错定位修复" in lb for lb in labels)
    assert events[-1]["t"] == "final"


async def test_missing_key_yields_error_event():
    llm = FakeLLM([])
    llm.ready = False
    events = await collect(RunRequest(message="随便"), llm)
    assert events[0]["t"] == "error"
    assert "密钥" in events[0]["message"]


def test_extract_html_handles_fence():
    assert extract_html("```html\n" + GOOD + "\n```").endswith("</html>")
