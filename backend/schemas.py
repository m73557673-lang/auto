from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class MonitoringEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    service: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ._/-]*$")
    observed_at: datetime = Field(alias="observedAt")
    kind: Literal["http_failure", "timeout", "healthy"]
    status_code: int | None = Field(default=None, alias="statusCode", ge=100, le=599)
    response_time_ms: float | None = Field(default=None, alias="responseTimeMs", ge=0, le=3_600_000)
    message: str = Field(default="", max_length=2000)

    @field_validator("observed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("observedAt must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_status_kind(self) -> MonitoringEventIn:
        if self.status_code is None:
            return self
        status_is_healthy = 200 <= self.status_code < 300
        if self.kind == "healthy" and not status_is_healthy:
            raise ValueError("healthy events must include a 2xx status code or omit statusCode")
        if self.kind == "http_failure" and status_is_healthy:
            raise ValueError("http_failure events cannot include a 2xx status code")
        return self


class IncidentAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    force: bool = False


class IncidentAnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: int | None = None
    incident_id: str = Field(alias="incidentId")
    summary: str = Field(min_length=1, max_length=4000)
    observed_symptoms: list[str] = Field(alias="observedSymptoms")
    supporting_evidence: list[str] = Field(alias="supportingEvidence")
    possible_root_causes: list[str] = Field(alias="possibleRootCauses")
    potential_impact: str = Field(alias="potentialImpact", max_length=4000)
    recommended_steps: list[str] = Field(alias="recommendedSteps")
    timeline: list[str]
    missing_information: list[str] = Field(alias="missingInformation")
    confidence: str = Field(min_length=1, max_length=500)
    model: str | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    status: str | None = None


class IncidentChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = Field(default=None, alias="conversationId", min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")

    @field_validator("message")
    @classmethod
    def require_nonblank_message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value.strip()


class IncidentChatResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    incident_id: str = Field(alias="incidentId")
    conversation_id: str = Field(alias="conversationId")
    answer: str = Field(min_length=1, max_length=8000)
    confidence: str = Field(min_length=1, max_length=500)
    created_at: str = Field(alias="createdAt")


class IncidentChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: int
    incident_id: str = Field(alias="incidentId")
    conversation_id: str = Field(alias="conversationId")
    role: Literal["user", "assistant"]
    content: str
    created_at: str = Field(alias="createdAt")
