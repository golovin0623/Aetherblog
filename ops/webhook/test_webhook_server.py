#!/usr/bin/env python3
import importlib.util
import os
import socket
import socket as socket_module
import unittest


os.environ.setdefault("WEBHOOK_SECRET", "x" * 32)
os.environ.setdefault("WEBHOOK_REQUEST_TIMEOUT", "7")
os.environ.setdefault("WEBHOOK_MAX_BODY_BYTES", "16")


def load_webhook_server():
    here = os.path.dirname(os.path.abspath(__file__))
    module_path = os.path.join(here, "webhook_server.py")
    spec = importlib.util.spec_from_file_location("webhook_server_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


webhook_server = load_webhook_server()


class FakeRfile:
    def __init__(self, data=b"", exc=None):
        self.data = data
        self.exc = exc
        self.read_called = False

    def read(self, size):
        self.read_called = True
        if self.exc is not None:
            raise self.exc
        return self.data[:size]


class FakeHandler:
    def __init__(self, headers, rfile):
        self.headers = headers
        self.rfile = rfile


class RequestBodyTests(unittest.TestCase):
    def test_rejects_invalid_content_length(self):
        handler = FakeHandler({"Content-Length": "oops"}, FakeRfile())

        body, error = webhook_server._read_request_body(handler)

        self.assertEqual(body, b"")
        self.assertEqual(error, (400, "Invalid Content-Length"))
        self.assertFalse(handler.rfile.read_called)

    def test_rejects_oversized_body_without_reading(self):
        handler = FakeHandler({"Content-Length": "17"}, FakeRfile(b"x" * 17))

        body, error = webhook_server._read_request_body(handler)

        self.assertEqual(body, b"")
        self.assertEqual(error, (413, "Request body too large"))
        self.assertFalse(handler.rfile.read_called)

    def test_reports_body_read_timeout(self):
        handler = FakeHandler(
            {"Content-Length": "2"},
            FakeRfile(exc=socket_module.timeout("timed out")),
        )

        body, error = webhook_server._read_request_body(handler)

        self.assertEqual(body, b"")
        self.assertEqual(error, (408, "Request body timed out"))

    def test_reports_incomplete_body(self):
        handler = FakeHandler({"Content-Length": "4"}, FakeRfile(b"xy"))

        body, error = webhook_server._read_request_body(handler)

        self.assertEqual(body, b"")
        self.assertEqual(error, (400, "Incomplete request body"))


class ParseRequestTests(unittest.TestCase):
    # #601 review fix: commit_sha 必须是完整 hex SHA, 否则 git reset 会跟着
    # 浮动 ref 走, 静默绕过 PR 想加的 pin 保护.
    GOOD_SHA = "0123456789abcdef0123456789abcdef01234567"

    def test_empty_body_is_valid(self):
        services, sha, ok = webhook_server._parse_request(b"")
        self.assertEqual(services, "")
        self.assertEqual(sha, "")
        self.assertTrue(ok)

    def test_non_object_body_rejected(self):
        services, sha, ok = webhook_server._parse_request(b'"a string"')
        self.assertFalse(ok)
        self.assertEqual(services, "")
        self.assertEqual(sha, "")

    def test_valid_services_only(self):
        body = b'{"services": "backend ai-service"}'
        services, sha, ok = webhook_server._parse_request(body)
        self.assertTrue(ok)
        self.assertEqual(services, "backend ai-service")
        self.assertEqual(sha, "")

    def test_valid_commit_sha_only(self):
        body = ('{"commit_sha": "%s"}' % self.GOOD_SHA).encode()
        services, sha, ok = webhook_server._parse_request(body)
        self.assertTrue(ok)
        self.assertEqual(services, "")
        self.assertEqual(sha, self.GOOD_SHA)

    def test_uppercase_sha_normalized_to_lowercase(self):
        body = ('{"commit_sha": "%s"}' % self.GOOD_SHA.upper()).encode()
        services, sha, ok = webhook_server._parse_request(body)
        self.assertTrue(ok)
        self.assertEqual(sha, self.GOOD_SHA)

    def test_short_sha_rejected(self):
        # 短哈希在 cat-file -e 下能匹配, 但唯一性不可保证, 也不算"完整 pin".
        body = b'{"commit_sha": "abc1234"}'
        _services, _sha, ok = webhook_server._parse_request(body)
        self.assertFalse(ok)

    def test_ref_name_as_sha_rejected(self):
        # 关键的安全 case: HEAD / FETCH_HEAD / 分支名都不能伪装成 SHA.
        for bad in (b"HEAD", b"FETCH_HEAD", b"main", b"origin/main", b"refs/heads/main"):
            body = b'{"commit_sha": "' + bad + b'"}'
            _services, _sha, ok = webhook_server._parse_request(body)
            self.assertFalse(ok, "should reject ref name: %r" % bad)

    def test_non_hex_chars_rejected(self):
        # 40 长度但含非 hex 字符 (例如 g): 拒绝.
        body = b'{"commit_sha": "g123456789abcdef0123456789abcdef01234567"}'
        _services, _sha, ok = webhook_server._parse_request(body)
        self.assertFalse(ok)

    def test_invalid_services_still_rejected_with_sha(self):
        # 提供了合法 SHA 也不能洗掉非法 services.
        body = ('{"services": "evil", "commit_sha": "%s"}' % self.GOOD_SHA).encode()
        _services, _sha, ok = webhook_server._parse_request(body)
        self.assertFalse(ok)

    def test_legacy_parse_services_still_works(self):
        # 旧别名 _parse_services 仍要返回 (services, ok) 两元组, 避免外部脚本崩.
        services, ok = webhook_server._parse_services(b'{"services": "backend"}')
        self.assertTrue(ok)
        self.assertEqual(services, "backend")


class DeployHTTPServerTests(unittest.TestCase):
    def test_accepted_connections_get_a_timeout(self):
        server = webhook_server.DeployHTTPServer(("127.0.0.1", 0), webhook_server.WebhookHandler)
        client = socket.create_connection(server.server_address)
        try:
            conn, _ = server.get_request()
            try:
                self.assertEqual(conn.gettimeout(), webhook_server.REQUEST_TIMEOUT)
                self.assertTrue(server.daemon_threads)
            finally:
                conn.close()
        finally:
            client.close()
            server.server_close()


class DeploymentFailureSummaryTests(unittest.TestCase):
    def test_preserves_stdout_diagnostics_when_stderr_is_present(self):
        summary = webhook_server._deployment_failure_summary(
            "compose ps output\nadmin exited",
            "deploy command failed",
        )

        self.assertIn("stdout:\ncompose ps output\nadmin exited", summary)
        self.assertIn("stderr:\ndeploy command failed", summary)

    def test_reports_missing_process_output(self):
        self.assertEqual(
            webhook_server._deployment_failure_summary("", ""),
            "deploy failed without process output",
        )


if __name__ == "__main__":
    unittest.main()
