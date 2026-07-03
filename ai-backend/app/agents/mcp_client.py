import os
from typing import Any

import requests


class McpClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("MCP_SERVER_URL", "http://localhost:4100")).rstrip("/")

    def get(self, path: str, timeout: int = 20) -> dict[str, Any] | None:
        try:
            response = requests.get(f"{self.base_url}/{path.lstrip('/')}", timeout=timeout)
            if not response.ok:
                return None
            payload = response.json()
            return payload if isinstance(payload, dict) else None
        except Exception:
            return None
