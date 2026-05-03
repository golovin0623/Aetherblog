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


if __name__ == "__main__":
    unittest.main()
