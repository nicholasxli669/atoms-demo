"""集中读取环境变量：密钥只从环境来，不落仓库。"""

from __future__ import annotations

import os
from dataclasses import dataclass


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


def load_settings() -> Settings:
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
