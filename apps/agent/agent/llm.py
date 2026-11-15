"""OpenAI 兼容协议的流式客户端（默认 DeepSeek）。

只用 httpx，不引入 openai SDK：协议就是 /chat/completions，够用且少一层依赖。
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from .config import Settings
from .prompts import Message


class LLMError(RuntimeError):
    pass


class LLM:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    @property
    def ready(self) -> bool:
        return self._s.ready

    @property
    def model(self) -> str:
        return self._s.model

    def _payload(
        self, messages: list[Message], stream: bool, max_tokens: int, temperature: float
    ) -> dict:
        return {
            "model": self._s.model,
            "messages": messages,
            "stream": stream,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._s.api_key}",
        }

    async def once(
        self, messages: list[Message], max_tokens: int = 512, temperature: float = 0.35
    ) -> str:
        """一次性返回（规划、命名这类小请求）。"""
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                f"{self._s.base_url}/chat/completions",
                headers=self._headers,
                json=self._payload(messages, False, max_tokens, temperature),
            )
            if res.status_code >= 400:
                raise LLMError(f"LLM {res.status_code}: {res.text[:300]}")
            data = res.json()
        choices = data.get("choices") or []
        if not choices:
            return ""
        return (choices[0].get("message") or {}).get("content") or ""

    async def stream(
        self,
        messages: list[Message],
        max_tokens: int = 8000,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        """流式返回文本增量。"""
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15)) as client:
            async with client.stream(
                "POST",
                f"{self._s.base_url}/chat/completions",
                headers=self._headers,
                json=self._payload(messages, True, max_tokens, temperature),
            ) as res:
                if res.status_code >= 400:
                    body = (await res.aread()).decode("utf-8", "ignore")
                    raise LLMError(f"LLM {res.status_code}: {body[:300]}")
                async for line in res.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    piece = (choices[0].get("delta") or {}).get("content")
                    if piece:
                        yield piece
