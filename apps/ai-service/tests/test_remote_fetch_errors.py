import httpx

from app.api.routes.providers import format_remote_fetch_error


def test_format_remote_fetch_error_status_error():
    request = httpx.Request("GET", "https://example.com/models")
    response = httpx.Response(401, request=request, text="unauthorized")
    exc = httpx.HTTPStatusError("bad status", request=request, response=response)
    assert format_remote_fetch_error(exc).startswith("Remote API error 401:")


def test_format_remote_fetch_error_request_error():
    request = httpx.Request("GET", "https://example.com/models")
    exc = httpx.RequestError("connection failed", request=request)
    assert format_remote_fetch_error(exc).startswith("Remote API request failed:")


def test_format_remote_fetch_error_generic():
    exc = RuntimeError("boom")
    assert format_remote_fetch_error(exc) == "Remote API error: boom"
