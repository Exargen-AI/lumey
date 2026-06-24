# AUTO-GENERATED from the Lumey contract by sdk/scripts/generatePython.ts.
# Do not edit by hand — run `npm run gen:python` to regenerate.

class LumeyError(Exception):
    def __init__(self, message, status=None, code=None, run_id=None, trace_id=None, retryable=False):
        super().__init__(message)
        self.status = status
        self.code = code
        self.run_id = run_id
        self.trace_id = trace_id
        self.retryable = retryable


class LumeyConnectionError(LumeyError):
    def __init__(self, message):
        super().__init__(message, retryable=True)


class LumeyAuthError(LumeyError):
    pass


class LumeyUnavailableError(LumeyError):
    pass


class LumeyContractError(LumeyError):
    pass


class BudgetExceededError(LumeyError):
    pass


class ApprovalRequiredError(LumeyError):
    pass


class ClarificationPendingError(LumeyError):
    pass


_CODE_MAP = {
    "BUDGET_EXCEEDED": BudgetExceededError,
    "APPROVAL_REQUIRED": ApprovalRequiredError,
    "CLARIFICATION_PENDING": ClarificationPendingError,
}


def error_from_response(status, body):
    err = (body or {}).get("error") or {} if isinstance(body, dict) else {}
    ctx = dict(
        status=status,
        code=err.get("code"),
        run_id=err.get("run_id") or err.get("runId"),
        trace_id=err.get("trace_id") or err.get("traceId"),
        retryable=status == 429 or status >= 500,
    )
    message = err.get("message") or "request failed ({})".format(status)
    code = err.get("code")
    if code and code in _CODE_MAP:
        return _CODE_MAP[code](message, **ctx)
    if status in (401, 403):
        return LumeyAuthError(message, **ctx)
    if status == 429 or status >= 500:
        return LumeyUnavailableError(message, **ctx)
    return LumeyError(message, **ctx)
