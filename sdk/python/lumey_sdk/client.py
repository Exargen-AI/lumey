# AUTO-GENERATED from the Lumey contract by sdk/scripts/generatePython.ts.
# Do not edit by hand — run `npm run gen:python` to regenerate.

import json
import time
import uuid
import urllib.request
import urllib.error
from urllib.parse import urlparse

from .errors import error_from_response, LumeyConnectionError

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_of(base_url):
    p = urlparse(base_url)
    return "{}://{}".format(p.scheme, p.netloc)


class _Transport:
    def __init__(self, base_url, token, timeout=30.0, max_retries=2, retry_base=0.2, origin=None):
        self._base = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_base = retry_base
        self._origin = origin or _origin_of(base_url)

    def request(self, method, path, body=None, idempotency_key=None):
        url = self._base + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"authorization": "Bearer " + self._token, "accept": "application/json", "origin": self._origin}
        if body is not None:
            headers["content-type"] = "application/json"
        if method in _WRITE_METHODS:
            headers["idempotency-key"] = idempotency_key or str(uuid.uuid4())

        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    text = resp.read().decode("utf-8")
                    parsed = json.loads(text) if text else None
                    if isinstance(parsed, dict) and "data" in parsed:
                        return parsed["data"]
                    return parsed
            except urllib.error.HTTPError as e:
                text = e.read().decode("utf-8") if e.fp else ""
                parsed = json.loads(text) if text else None
                err = error_from_response(e.code, parsed)
                if err.retryable and attempt < self._max_retries:
                    time.sleep(self._retry_base * (2 ** attempt))
                    attempt += 1
                    continue
                raise err
            except urllib.error.URLError as e:
                if attempt < self._max_retries:
                    time.sleep(self._retry_base * (2 ** attempt))
                    attempt += 1
                    continue
                raise LumeyConnectionError(str(e))


class TasksResource:
    def __init__(self, transport):
        self._t = transport

    def next(self):
        """The next ready task for the authenticated agent, or null."""
        return self._t.request("GET", "/agents/me/next-task")


class RunsResource:
    def __init__(self, transport):
        self._t = transport

    def start(self, task_id, idempotency_key=None):
        """Dispatch an agent run against a task."""
        return self._t.request("POST", f"/tasks/{task_id}/runs", body={}, idempotency_key=idempotency_key)

    def list(self, task_id):
        """The task's runs, newest first."""
        return self._t.request("GET", f"/tasks/{task_id}/runs")

    def get(self, task_id, run_id):
        """One run with its steps and trace."""
        return self._t.request("GET", f"/tasks/{task_id}/runs/{run_id}")

    def cancel(self, task_id, run_id, idempotency_key=None):
        """Cancel an in-flight run."""
        return self._t.request("POST", f"/tasks/{task_id}/runs/{run_id}/cancel", body={}, idempotency_key=idempotency_key)


class LumeyClient:
    """The Lumey Platform SDK (Python). Generated from the contract."""

    def __init__(self, base_url, token, timeout=30.0, max_retries=2, origin=None):
        transport = _Transport(base_url, token, timeout=timeout, max_retries=max_retries, origin=origin)
        self.tasks = TasksResource(transport)
        self.runs = RunsResource(transport)
