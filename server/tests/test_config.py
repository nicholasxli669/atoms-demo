"""config 单测：.env 能被读到，且不覆盖真实环境变量（部署时 systemd 注入优先）。"""

from pathlib import Path

from agent.config import load_settings


def test_dotenv_fills_missing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    env = tmp_path / ".env"
    env.write_text('DEEPSEEK_API_KEY=sk-from-file\nLLM_MODEL="from-file"\n# 注释\n\n', encoding="utf-8")

    s = load_settings(env)

    assert s.api_key == "sk-from-file"
    assert s.model == "from-file"
    assert s.ready is True


def test_real_env_wins(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-from-env")
    env = tmp_path / ".env"
    env.write_text("DEEPSEEK_API_KEY=sk-from-file\n", encoding="utf-8")

    assert load_settings(env).api_key == "sk-from-env"


def test_missing_env_file_is_fine(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    s = load_settings(tmp_path / "nope.env")

    assert s.ready is False  # 没有密钥 → 离线演示模式


def test_dotenv_with_bom(tmp_path: Path, monkeypatch) -> None:
    """Windows PowerShell 5.1 的 Set-Content -Encoding utf8 会写 BOM，不能因此读不到密钥。"""
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_bytes("\ufeffDEEPSEEK_API_KEY=sk-bom\n".encode("utf-8"))

    assert load_settings(env).api_key == "sk-bom"
