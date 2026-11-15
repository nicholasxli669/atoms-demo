"""校验器单测：与 Web 端 TS 版保持同一套判据。"""

from agent.validate import extract_html, looks_truncated, validate_app

GOOD = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>示例应用</title>
<style>
:root{--bg:#111;--ink:#eee;--card:#1c1c1c}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;line-height:1.6}
header{padding:24px 16px;border-bottom:1px solid #2a2a2a}
.card{background:var(--card);border-radius:12px;padding:16px;margin:16px}
button{cursor:pointer;border:0;border-radius:8px;padding:8px 14px;background:#4f46e5;color:#fff}
</style></head>
<body><header><h1>示例应用</h1></header><main class="card"><div id="app"></div></main>
<script>
const KEY = "app:demo";
const seed = [{ id: 1, text: "示例任务", done: false }];
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? seed; } catch { return seed; } };
localStorage.setItem(KEY, JSON.stringify(read()));
document.getElementById("app").textContent = "ok";
</script></body></html>"""


def test_extract_html_strips_fence_and_prose():
    raw = "好的，下面是代码：\n```html\n" + GOOD + "\n```\n希望有帮助！"
    out = extract_html(raw)
    assert out.startswith("<!DOCTYPE html>")
    assert out.endswith("</html>")


def test_full_app_passes():
    r = validate_app(GOOD)
    assert r.ok is True
    assert r.stats.has_storage and r.stats.has_style and r.stats.has_script
    assert r.stats.external == 0


def test_truncated_output_fails_and_is_detected():
    cut = GOOD[: GOOD.index("</script>") + 9]
    r = validate_app(cut)
    assert r.ok is False
    assert any("未闭合" in e for e in r.errors())
    assert looks_truncated(cut) is True
    assert looks_truncated(GOOD) is False


def test_unbalanced_script_detected():
    r = validate_app(GOOD.replace("</script>", ""))
    assert r.ok is False
    assert any("script" in e for e in r.errors())


def test_external_resource_is_only_a_warning():
    html = GOOD.replace(
        "<title>示例应用</title>",
        '<title>示例应用</title><script src="https://cdn.example.com/a.js"></script>',
    )
    r = validate_app(html)
    assert r.ok is True
    assert any("外部资源" in i.msg for i in r.issues)


def test_empty_content_fails():
    r = validate_app("")
    assert r.ok is False
    assert any("过短" in e for e in r.errors())
