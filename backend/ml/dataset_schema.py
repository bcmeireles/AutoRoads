from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from backend.app.feature_engineering import FEATURE_NAMES
from backend.app.schemas import (
    CarState,
    CityContext,
    Destination,
    ParkingCandidate,
    ParkingDecisionRequest,
    PreferenceWeights,
)


class DatasetMetadata(BaseModel):
    seed: int
    sample_index: int = Field(..., ge=0)
    scenario_profile: str
    candidate_ids: list[str] = Field(..., min_length=4, max_length=8)


class CandidateFeatureRow(BaseModel):
    candidate_id: str
    features: list[float]
    label: float
    eligible: bool


class OracleCandidateScore(BaseModel):
    candidate_id: str
    score: float
    eligible: bool
    rank: int = Field(..., ge=1)


class OracleLabel(BaseModel):
    selected_candidate_id: str | None
    selected_candidate_index: int | None
    scores: list[OracleCandidateScore] = Field(..., min_length=4, max_length=8)


class SyntheticParkingSample(BaseModel):
    metadata: DatasetMetadata
    feature_names: list[str]
    car: CarState
    destination: Destination
    city: CityContext
    weights: PreferenceWeights
    candidates: list[ParkingCandidate] = Field(..., min_length=4, max_length=8)
    candidate_features: list[CandidateFeatureRow] = Field(..., min_length=4, max_length=8)
    oracle_label: OracleLabel

    @model_validator(mode="after")
    def validate_feature_contract(self) -> "SyntheticParkingSample":
        candidate_ids = [candidate.id for candidate in self.candidates]
        feature_ids = [row.candidate_id for row in self.candidate_features]
        score_ids = [score.candidate_id for score in self.oracle_label.scores]

        if self.feature_names != FEATURE_NAMES:
            raise ValueError("feature_names must match backend FEATURE_NAMES")
        if self.metadata.candidate_ids != candidate_ids:
            raise ValueError("metadata candidate_ids must match candidates")
        if feature_ids != candidate_ids:
            raise ValueError("candidate_features must be in candidate order")
        if score_ids != candidate_ids:
            raise ValueError("oracle scores must be in candidate order")
        if any(len(row.features) != len(FEATURE_NAMES) for row in self.candidate_features):
            raise ValueError("candidate feature vectors must match FEATURE_NAMES length")
        if self.oracle_label.selected_candidate_index is not None:
            selected_index = self.oracle_label.selected_candidate_index
            if selected_index < 0 or selected_index >= len(candidate_ids):
                raise ValueError("selected_candidate_index is out of range")
            if candidate_ids[selected_index] != self.oracle_label.selected_candidate_id:
                raise ValueError("selected_candidate_index does not match selected_candidate_id")
        return self

    def as_request(self) -> ParkingDecisionRequest:
        return ParkingDecisionRequest(
            car=self.car,
            destination=self.destination,
            candidates=self.candidates,
            city=self.city,
            weights=self.weights,
        )
