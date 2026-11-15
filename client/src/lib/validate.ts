/**
 * 生成代码的静态校验：在交付给用户预览前先卡一遍明显错误。
 * 纯函数，方便单测与在客户端复用。
 *
 * 除 issues（错误/建议列表）外，还输出 checks（逐项体检结果），
 * 用于在界面上把"我们检查了什么"摊开给用户看。
 */

export interface Issue {
  level: "error" | "warn";
  msg: string;
}

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ValidateResult {
  ok: boolean;
  issues: Issue[];
  checks: Check[];
  stats: {
    lines: number;
    bytes: number;
    hasStyle: boolean;
    hasScript: boolean;
    hasStorage: boolean;
    external: number;
  };
}

/** 从模型输出里抽取 HTML：去掉 markdown 围栏和前后解释文字 */
export function extractHtml(raw: string): string {
  let s = (raw || "").trim();
  // 去掉 ```html ... ``` 围栏
  s = s.replace(/^```(?:html|HTML)?\s*/g, "").replace(/```\s*$/g, "");
  const lower = s.toLowerCase();
  const start = Math.min(
    ...["<!doctype", "<html"].map((k) => {
      const i = lower.indexOf(k);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    }),
  );
  if (start !== Number.MAX_SAFE_INTEGER && start > 0) s = s.slice(start);
  const end = lower.lastIndexOf("</html>");
  if (end > 0) {
    const abs = s.toLowerCase().lastIndexOf("</html>");
    if (abs > 0) s = s.slice(0, abs + 7);
  }
  return s.trim();
}

function count(hay: string, re: RegExp): number {
  return (hay.match(re) || []).length;
}

export function validateApp(code: string): ValidateResult {
  const src = code || "";
  const lower = src.toLowerCase();
  const issues: Issue[] = [];

  const lines = src.split("\n").length;
  const bytes = Buffer.byteLength(src, "utf8");
  const hasStyle = /<style[\s>]/i.test(src);
  const hasScript = /<script[\s>][\s\S]*?<\/script>/i.test(src);
  const hasStorage = /localstorage/i.test(src);
  const external =
    count(src, /<(?:script|link|img|iframe)[^>]+(?:src|href)=["']https?:\/\//gi) +
    count(src, /@import\s+url\(\s*["']?https?:/gi);

  const hasDoctype = /<!doctype html|<html[\s>]/i.test(src);
  const hasClosed = lower.includes("</html>");
  const hasBody = /<body[\s>]/i.test(src);
  const openScript = count(lower, /<script[\s>]/g);
  const closeScript = count(lower, /<\/script>/g);
  const openStyle = count(lower, /<style[\s>]/g);
  const closeStyle = count(lower, /<\/style>/g);

  if (bytes < 500) issues.push({ level: "error", msg: `输出内容过短（${bytes} 字节），疑似未完整生成` });
  if (!hasDoctype) issues.push({ level: "error", msg: "缺少 <!DOCTYPE html> / <html> 根节点" });
  if (!hasClosed) issues.push({ level: "error", msg: "HTML 未闭合（缺少 </html>），输出可能被截断" });
  if (!hasBody) issues.push({ level: "error", msg: "缺少 <body>" });

  if (openScript !== closeScript)
    issues.push({
      level: "error",
      msg: `<script> 标签不配对（${openScript} 开 / ${closeScript} 闭）`,
    });

  if (openStyle !== closeStyle)
    issues.push({ level: "error", msg: `<style> 标签不配对（${openStyle} 开 / ${closeStyle} 闭）` });

  if (!hasStyle && !/<link[^>]+rel=["']?stylesheet/i.test(src))
    issues.push({ level: "warn", msg: "没有任何样式表，界面会退化为浏览器默认样式" });
  if (!hasScript) issues.push({ level: "warn", msg: "没有脚本，应用无法交互" });
  if (!hasStorage)
    issues.push({ level: "warn", msg: "未使用 localStorage，刷新后数据会丢失（要求数据持久化）" });
  if (external > 0)
    issues.push({ level: "warn", msg: `存在 ${external} 处外部资源引用（离线/内网环境可能加载失败）` });
  if (lower.includes("alert(") || lower.includes("prompt("))
    issues.push({ level: "warn", msg: "使用了 alert()/prompt() 原生弹窗，体验较差" });

  const checks: Check[] = [
    { key: "doctype", label: "DOCTYPE / html 根节点", ok: hasDoctype },
    { key: "closed", label: "</html> 已闭合", ok: hasClosed },
    { key: "body", label: "<body> 存在", ok: hasBody },
    {
      key: "tags",
      label: "script / style 配对",
      ok: openScript === closeScript && openStyle === closeStyle,
      detail: `script ${openScript}/${closeScript} · style ${openStyle}/${closeStyle}`,
    },
    { key: "size", label: "体积 ≥ 500 字节", ok: bytes >= 500, detail: `${bytes} 字节` },
    { key: "storage", label: "localStorage 持久化", ok: hasStorage },
    {
      key: "offline",
      label: "零外链（可离线）",
      ok: external === 0,
      detail: external > 0 ? `${external} 处外链` : undefined,
    },
  ];

  const ok = !issues.some((i) => i.level === "error");
  return {
    ok,
    issues,
    checks,
    stats: { lines, bytes, hasStyle, hasScript, hasStorage, external },
  };
}
