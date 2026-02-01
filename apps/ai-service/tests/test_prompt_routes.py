from __future__ import annotations

import pytest

from app.api.routes import prompts as prompts_module
from app.services.llm_router import LlmRouter
from tests.support import FakeConn, FakePool


class FakeModelRouter:
    def __init__(self, conn: FakeConn):
        self.pool = FakePool(conn)

    async def resolve_routing(self, task_type: str):
        return None

    async def update_routing(self, **_kwargs):
        return True


class FakeLlmRouter(LlmRouter):
    def __init__(self, conn: FakeConn):
        self.model_router = FakeModelRouter(conn)


@pytest.mark.asyncio
async def test_prompt_routes():
    def fetch(_query, _args):
        return [{"task_type": "summary", "default_prompt": "default", "custom_prompt": "custom"}]

    def fetchrow(_query, _args):
        return {"config_override": {"prompt_template": "custom"}}

    conn = FakeConn(fetch=fetch, fetchrow=fetchrow)
    llm = FakeLlmRouter(conn)

    all_prompts = await prompts_module.get_all_prompts(llm=llm)
    assert all_prompts.data[0].task_type == "summary"

    prompt = await prompts_module.get_prompt_config("summary", llm=llm)
    assert prompt.data.custom_prompt == "custom"

    updated = await prompts_module.update_prompt_config(
        "summary",
        prompts_module.PromptUpdateRequest(prompt_template="override"),
        llm=llm,
    )
    assert updated.data is True
