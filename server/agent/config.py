"""集中读取环境变量：密钥只从环境来，不落仓库。

同时支持 server/.env（本地开发方便）；**已存在的环境变量优先**，systemd 的 EnvironmentFile 不会被覆盖。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


@dataclass(frozen=True)
class Settings:
    api_key: str
    base_url: str
    model: str
    port: int

    @property
    def ready(self) -> bool:
        """有没有可用的模型密钥；没有就进离线演示模式。"""
        return bool(self.api_key.strip())


def load_dotenv(path: Path = DEFAULT_ENV_FILE) -> None:
    """把 KEY=VALUE 灌进环境变量；不覆盖已有值，忽略空行/注释/引号。

    用 utf-8-sig 读：Windows PowerShell 5.1 的 `Set-Content -Encoding utf8` 会写 BOM，
    普通 utf-8 读会让首行的键变成 "\\ufeffDEEPSEEK_API_KEY"，密钥静默失效。
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_settings(env_file: Path = DEFAULT_ENV_FILE) -> Settings:
    load_dotenv(env_file)
    key = (
        os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    base = (os.getenv("LLM_BASE_URL") or "https://api.deepseek.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL") or "deepseek-chat"
    port = int(os.getenv("AGENT_PORT") or "8100")
    return Settings(api_key=key, base_url=base, model=model, port=port)
