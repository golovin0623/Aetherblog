from __future__ import annotations

from typing import Any, Callable


class FakeTransaction:
    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeConn:
    def __init__(
        self,
        fetch: Callable[[str, tuple[Any, ...]], list[dict]] | None = None,
        fetchrow: Callable[[str, tuple[Any, ...]], dict | None] | None = None,
        execute: Callable[[str, tuple[Any, ...]], Any] | None = None,
        executemany: Callable[[str, list[tuple[Any, ...]]], Any] | None = None,
    ) -> None:
        self._fetch = fetch
        self._fetchrow = fetchrow
        self._execute = execute
        self._executemany = executemany
        self.fetch_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.fetchrow_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.executemany_calls: list[tuple[str, list[tuple[Any, ...]]]] = []

    async def fetch(self, query: str, *args: Any):
        self.fetch_calls.append((query, args))
        if self._fetch:
            return self._fetch(query, args)
        return []

    async def fetchrow(self, query: str, *args: Any):
        self.fetchrow_calls.append((query, args))
        if self._fetchrow:
            return self._fetchrow(query, args)
        return None

    async def execute(self, query: str, *args: Any):
        self.execute_calls.append((query, args))
        if self._execute:
            return self._execute(query, args)
        return "OK"

    async def executemany(self, query: str, values: list[tuple[Any, ...]]):
        self.executemany_calls.append((query, values))
        if self._executemany:
            return self._executemany(query, values)
        return None

    def transaction(self):
        return FakeTransaction()


class FakeAcquire:
    def __init__(self, conn: FakeConn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakePool:
    def __init__(self, conn: FakeConn):
        self.conn = conn

    def acquire(self):
        return FakeAcquire(self.conn)
