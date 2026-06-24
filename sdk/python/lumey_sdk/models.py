# AUTO-GENERATED from the Lumey contract by sdk/scripts/generatePython.ts.
# Do not edit by hand — run `npm run gen:python` to regenerate.

from __future__ import annotations
from typing import TypedDict, Optional, List, Literal, Any, Dict


RunStatus = Literal["QUEUED", "RUNNING", "AWAITING_REVIEW", "AWAITING_INPUT", "BLOCKED", "SUCCEEDED", "FAILED", "CANCELLED"]


RunStepType = Literal["PLAN", "TOOL_CALL", "EDIT", "COMMAND", "TEST", "REVIEW_REQUEST"]


class TaskRef(TypedDict, total=False):
    id: str
    title: str
    status: str
    projectId: str
    agentPoolRole: Optional[str]


class AgentRunSummary(TypedDict, total=False):
    id: str
    taskId: str
    agentId: str
    status: RunStatus
    model: Optional[str]
    summary: Optional[str]
    error: Optional[str]
    inputTokens: float
    outputTokens: float
    totalTokens: float
    startedAt: Optional[str]
    endedAt: Optional[str]
    createdAt: str


class RunStep(TypedDict, total=False):
    id: str
    seq: float
    type: RunStepType
    status: str
    title: str
    detail: Optional[str]
    startedAt: str
    endedAt: Optional[str]


class RunEvent(TypedDict, total=False):
    id: str
    seq: float
    type: str
    payload: Any
    at: str


class AgentRunDetail(TypedDict, total=False):
    id: str
    taskId: str
    agentId: str
    status: RunStatus
    model: Optional[str]
    summary: Optional[str]
    error: Optional[str]
    inputTokens: float
    outputTokens: float
    totalTokens: float
    startedAt: Optional[str]
    endedAt: Optional[str]
    createdAt: str
    steps: List[RunStep]
    events: List[RunEvent]
