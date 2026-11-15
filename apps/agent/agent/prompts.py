"""Agent 提示词：规划 / 生成 / 修改 / 修复 / 续写。

与 apps/studio/src/lib/prompts.ts 保持一致，避免两个服务行为漂移。
"""

from __future__ import annotations

import json
import re
from typing import Any

Message = dict[str, str]

HARD_RULES = """【输出格式 — 违反即视为失败】
- 只输出 HTML 源码本身：从 <!DOCTYPE html> 开始，到 </html> 结束。
- 不要 markdown 代码围栏，不要任何解释、前言、后记、注释性开场白。

【技术要求】
1. 单文件自包含：CSS 写进 <style>，JS 写进 <script>；禁止任何外部资源（不要 CDN、外链字体/图片/图标库）。图标用内联 SVG 或 emoji。
2. 数据必须持久化：使用 localStorage，key 统一加 "app:" 前缀；读取时做 JSON.parse 的 try/catch，刷新后数据不能丢。
3. 交互必须真实可用：按钮点击有反馈，表单能提交+校验+错误提示，至少实现 3 个可操作功能（增/删/改/筛选/排序/切换）。
4. 首屏要有真实示例数据：localStorage 为空时写入种子数据，绝不给用户一个空白页面。
5. 响应式：≥360px 宽度下不出现横向滚动；桌面端有合理留白与最大宽度。
6. 可访问性：语义化标签、<label> 关联表单控件、图标按钮有 aria-label、对比度足够、键盘可操作。
7. 视觉要有设计感：统一主色 + 中性色、卡片/圆角/间距有节奏、hover/active 有过渡、有页头与空状态。不要裸露浏览器默认样式。
8. 规模 250~420 行，函数命名清晰；不要输出 console.log 噪音。
9. 不使用 alert()/confirm()/prompt()，改用页面内的 toast 或行内提示。

【输出前自检】
- HTML 里存在的 id/class 与 JS 里 querySelector 的一致吗？
- 增删改之后都调用了渲染函数吗？
- 日期/金额/计数等格式化逻辑在空数据时不会抛错吗？"""

CODE_SYSTEM = (
    '你是 Atoms Studio 的前端 Agent，负责把一句自然语言需求变成一个"打开就能用、点了有反应、刷新数据还在"的 Web 应用。\n\n'
    + HARD_RULES
)


def plan_messages(user_prompt: str) -> list[Message]:
    return [
        {
            "role": "system",
            "content": (
                "你是产品经理 + 前端架构师。用户会用一句话描述想要的 Web 应用，你要给出极简的实现方案。\n"
                "只输出 JSON，不要任何解释或代码围栏，格式严格为：\n"
                '{"name":"应用名称（≤12个汉字）","summary":"一句话说明它解决什么问题（≤40字）",'
                '"features":["功能点1","功能点2","功能点3"]}\n'
                "features 给 3~5 条，每条 ≤14 字，必须是可交互的具体功能（例如\"按状态筛选任务\"），"
                '不要写"良好的用户体验"这类空话。'
            ),
        },
        {"role": "user", "content": user_prompt},
    ]


def code_messages(prompt: str, plan: dict[str, Any] | None = None) -> list[Message]:
    plan_line = ""
    if plan:
        features = "、".join(plan.get("features") or [])
        plan_line = (
            f"\n【产品方案（请严格实现）】\n名称：{plan.get('name', '')}\n"
            f"定位：{plan.get('summary', '')}\n功能：{features}\n"
        )
    return [
        {"role": "system", "content": CODE_SYSTEM},
        {"role": "user", "content": f"需求：{prompt}\n{plan_line}\n请输出完整的单文件 HTML 应用。"},
    ]


def edit_messages(instruction: str, prev_code: str) -> list[Message]:
    return [
        {"role": "system", "content": CODE_SYSTEM},
        {
            "role": "user",
            "content": (
                "下面是一个已经能运行的 Web 应用源码。请在它的基础上按用户的新要求修改，"
                "输出**修改后的完整文件**（不是 diff）。\n"
                "修改原则：只做用户要求的改动，保留其它已有功能和整体视觉风格；除非必要不要推倒重写。\n"
                "体量控制（重要）：现有功能一个都不能丢。若加入新功能后总行数要超过 700 行，"
                "请压缩重复的 CSS 与示例数据来实现，\n"
                "绝不允许删掉已有功能，也绝不允许在 </html> 之前停下——输出被截断会导致整个应用不可用。\n\n"
                f"【用户的新要求】\n{instruction}\n\n【当前源码】\n{prev_code}"
            ),
        },
    ]


def continue_messages(tail: str) -> list[Message]:
    return [
        {"role": "system", "content": CODE_SYSTEM},
        {
            "role": "user",
            "content": (
                "下面是一份 HTML 源码**被截断的末尾片段**（不是开头，没有 </html>）。\n"
                "请**紧接着最后那个字符继续输出剩余内容**，直到补完 </html>。\n"
                "要求：不要重复已经输出过的代码，不要重新开始，不要任何解释或代码围栏，直接接着写。\n\n"
                f"【已输出的末尾片段】\n{tail}"
            ),
        },
    ]


def repair_messages(
    code: str, issues: list[dict[str, str]], runtime_logs: list[str] | None = None
) -> list[Message]:
    issue_text = "\n".join(f"- {i['msg']}" for i in issues)
    logs = ""
    if runtime_logs:
        logs = "\n【页面运行时控制台输出】\n" + "\n".join(runtime_logs[:20])
    return [
        {"role": "system", "content": CODE_SYSTEM},
        {
            "role": "user",
            "content": (
                "下面这份应用源码存在问题，请定位并修复，输出修复后的**完整** HTML 文件。\n\n"
                f"【发现的问题】\n{issue_text}{logs}\n\n【当前源码】\n{code}"
            ),
        },
    ]


def guess_name(prompt: str) -> str:
    clean = re.sub(r"[，。,.!?！？\s]+", "", prompt)[:12]
    return clean or "未命名应用"


def parse_plan(raw: str, fallback_name: str) -> dict[str, Any]:
    """从模型输出里稳健地解析规划 JSON；失败就退化成只有名字的方案。"""
    fallback: dict[str, Any] = {"name": fallback_name, "summary": "", "features": []}
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json|JSON)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return fallback
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return fallback
    if not isinstance(data, dict):
        return fallback

    name = str(data.get("name") or fallback_name)[:12]
    summary = str(data.get("summary") or "")[:60]
    raw_features = data.get("features")
    features: list[str] = []
    if isinstance(raw_features, list):
        features = [str(f)[:16] for f in raw_features if str(f).strip()][:5]
    return {"name": name or fallback_name, "summary": summary, "features": features}
