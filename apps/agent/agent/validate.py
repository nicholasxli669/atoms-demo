"""生成代码的静态校验：交付预览前先卡一遍明显错误。

与 apps/studio/src/lib/validate.ts 保持同一套规则，两边判据必须一致
（契约见 packages/contract/agent-events.md）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

Level = Literal["error", "warn"]

MIN_BYTES = 500


@dataclass
class Issue:
    level: Level
    msg: str


@dataclass
class Stats:
    lines: int = 0
    bytes: int = 0
    has_style: bool = False
    has_script: bool = False
    has_storage: bool = False
    external: int = 0


@dataclass
class ValidateResult:
    ok: bool
    issues: list[Issue] = field(default_factory=list)
    stats: Stats = field(default_factory=Stats)

    def errors(self) -> list[str]:
        return [i.msg for i in self.issues if i.level == "error"]

    def warns(self) -> int:
        return sum(1 for i in self.issues if i.level == "warn")


def extract_html(raw: str) -> str:
    """从模型输出里抽取 HTML：去掉 markdown 围栏和前后解释文字。"""
    s = (raw or "").strip()
    s = re.sub(r"^```(?:html|HTML)?\s*", "", s)
    s = re.sub(r"```\s*$", "", s)

    lower = s.lower()
    starts = [i for i in (lower.find("<!doctype"), lower.find("<html")) if i >= 0]
    if starts:
        start = min(starts)
        if start > 0:
            s = s[start:]

    end = s.lower().rfind("</html>")
    if end > 0:
        s = s[: end + len("</html>")]
    return s.strip()


def _count(hay: str, pattern: str) -> int:
    return len(re.findall(pattern, hay, flags=re.IGNORECASE))


def validate_app(code: str) -> ValidateResult:
    src = code or ""
    lower = src.lower()
    issues: list[Issue] = []

    stats = Stats(
        lines=src.count("\n") + 1,
        bytes=len(src.encode("utf-8")),
        has_style=bool(re.search(r"<style[\s>]", src, re.IGNORECASE)),
        has_script=bool(re.search(r"<script[\s>][\s\S]*?</script>", src, re.IGNORECASE)),
        has_storage="localstorage" in lower,
        external=_count(src, r"<(?:script|link|img|iframe)[^>]+(?:src|href)=[\"']https?://")
        + _count(src, r"@import\s+url\(\s*[\"']?https?:"),
    )

    if stats.bytes < MIN_BYTES:
        issues.append(Issue("error", f"输出内容过短（{stats.bytes} 字节），疑似未完整生成"))
    if not re.search(r"<!doctype html|<html[\s>]", src, re.IGNORECASE):
        issues.append(Issue("error", "缺少 <!DOCTYPE html> / <html> 根节点"))
    if "</html>" not in lower:
        issues.append(Issue("error", "HTML 未闭合（缺少 </html>），输出可能被截断"))
    if not re.search(r"<body[\s>]", src, re.IGNORECASE):
        issues.append(Issue("error", "缺少 <body>"))

    open_script = _count(lower, r"<script[\s>]")
    close_script = _count(lower, r"</script>")
    if open_script != close_script:
        issues.append(Issue("error", f"<script> 标签不配对（{open_script} 开 / {close_script} 闭）"))

    open_style = _count(lower, r"<style[\s>]")
    close_style = _count(lower, r"</style>")
    if open_style != close_style:
        issues.append(Issue("error", f"<style> 标签不配对（{open_style} 开 / {close_style} 闭）"))

    if not stats.has_style and not re.search(
        r"<link[^>]+rel=[\"']?stylesheet", src, re.IGNORECASE
    ):
        issues.append(Issue("warn", "没有任何样式表，界面会退化为浏览器默认样式"))
    if not stats.has_script:
        issues.append(Issue("warn", "没有脚本，应用无法交互"))
    if not stats.has_storage:
        issues.append(Issue("warn", "未使用 localStorage，刷新后数据会丢失（要求数据持久化）"))
    if stats.external > 0:
        issues.append(Issue("warn", f"存在 {stats.external} 处外部资源引用（离线/内网环境可能加载失败）"))
    if "alert(" in lower or "prompt(" in lower:
        issues.append(Issue("warn", "使用了 alert()/prompt() 原生弹窗，体验较差"))

    ok = not any(i.level == "error" for i in issues)
    return ValidateResult(ok=ok, issues=issues, stats=stats)


def looks_truncated(code: str) -> bool:
    """没有 </html> 收尾 = 大概率被模型单次输出上限截断。"""
    return not code.strip().lower().endswith("</html>") and "</html>" not in code.lower()
