/** Agent 提示词：规划 / 生成 / 修改 / 修复 */

import type { ChatMsg } from "./llm";
import type { Plan } from "./types";

const HARD_RULES = `【输出格式 — 违反即视为失败】
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
- 日期/金额/计数等格式化逻辑在空数据时不会抛错吗？`;

export const CODE_SYSTEM = `你是 Atoms Studio 的前端 Agent，负责把一句自然语言需求变成一个"打开就能用、点了有反应、刷新数据还在"的 Web 应用。

${HARD_RULES}`;

export function planMessages(userPrompt: string): ChatMsg[] {
  return [
    {
      role: "system",
      content: `你是产品经理 + 前端架构师。用户会用一句话描述想要的 Web 应用，你要给出极简的实现方案。
只输出 JSON，不要任何解释或代码围栏，格式严格为：
{"name":"应用名称（≤12个汉字）","summary":"一句话说明它解决什么问题（≤40字）","features":["功能点1","功能点2","功能点3"]}
features 给 3~5 条，每条 ≤14 字，必须是可交互的具体功能（例如"按状态筛选任务"），不要写"良好的用户体验"这类空话。`,
    },
    { role: "user", content: userPrompt },
  ];
}

export function codeMessages(opts: {
  prompt: string;
  plan?: Plan | null;
}): ChatMsg[] {
  const planLine = opts.plan
    ? `\n【产品方案（请严格实现）】\n名称：${opts.plan.name}\n定位：${opts.plan.summary}\n功能：${opts.plan.features.join("、")}\n`
    : "";
  return [
    { role: "system", content: CODE_SYSTEM },
    {
      role: "user",
      content: `需求：${opts.prompt}\n${planLine}\n请输出完整的单文件 HTML 应用。`,
    },
  ];
}

export function editMessages(opts: {
  instruction: string;
  prevCode: string;
}): ChatMsg[] {
  return [
    { role: "system", content: CODE_SYSTEM },
    {
      role: "user",
      content: `下面是一个已经能运行的 Web 应用源码。请在它的基础上按用户的新要求修改，输出**修改后的完整文件**（不是 diff）。
修改原则：只做用户要求的改动，保留其它已有功能和整体视觉风格；除非必要不要推倒重写。

【用户的新要求】
${opts.instruction}

【当前源码】
${opts.prevCode}`,
    },
  ];
}

export function repairMessages(opts: {
  code: string;
  issues: { level: string; msg: string }[];
  runtimeLogs?: string[];
}): ChatMsg[] {
  const issues = opts.issues.map((i) => `- ${i.msg}`).join("\n");
  const logs =
    opts.runtimeLogs && opts.runtimeLogs.length
      ? `\n【页面运行时控制台输出】\n${opts.runtimeLogs.slice(0, 20).join("\n")}`
      : "";
  return [
    { role: "system", content: CODE_SYSTEM },
    {
      role: "user",
      content: `下面这份应用源码存在问题，请定位并修复，输出修复后的**完整** HTML 文件。

【发现的问题】
${issues}${logs}

【当前源码】
${opts.code}`,
    },
  ];
}

/** 从模型输出中稳健地解析规划 JSON */
export function parsePlan(raw: string, fallbackName: string): Plan {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1)) as Partial<Plan>;
      const features = Array.isArray(j.features)
        ? j.features.filter((f) => typeof f === "string").slice(0, 5)
        : [];
      return {
        name: (j.name || fallbackName).toString().slice(0, 24),
        summary: (j.summary || "").toString().slice(0, 80),
        features: features.map((f) => String(f).slice(0, 24)),
      };
    } catch {
      /* fallthrough */
    }
  }
  return { name: fallbackName, summary: "", features: [] };
}
