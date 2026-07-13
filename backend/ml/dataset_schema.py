from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field, StrictBool, ValidationError, model_validator

from backend.app.feature_engineering import FEATURE_NAMES
from backend.app.oracle import is_eligible
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
    eligible: StrictBool


class OracleCandidateScore(BaseModel):
    candidate_id: str
    score: float
    eligible: StrictBool
    rank: int = Field(..., ge=1)


class OracleLabel(BaseModel):
    selected_candidate_id: str | None
    selected_candidate_index: int | None
    scores: list[OracleCandidateScore] = Field(..., min_length=4, max_length=8)


class GroupedCandidateRecord(BaseModel):
    group_id: int = Field(..., ge=0)
    candidate_index: int = Field(..., ge=0)
    candidate_id: str
    features: list[float]
    label: float
    eligible: StrictBool


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
        actual_eligibility = [is_eligible(candidate) for candidate in self.candidates]
        feature_eligibility = [row.eligible for row in self.candidate_features]
        score_eligibility = [score.eligible for score in self.oracle_label.scores]

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
        if feature_eligibility != actual_eligibility:
            raise ValueError("candidate feature eligibility must match candidates")
        if score_eligibility != actual_eligibility:
            raise ValueError("oracle score eligibility must match candidates")
        if [row.label for row in self.candidate_features] != [
            score.score for score in self.oracle_label.scores
        ]:
            raise ValueError("candidate feature labels must match oracle scores")

        selected_id = self.oracle_label.selected_candidate_id
        selected_index = self.oracle_label.selected_candidate_index
        if (selected_id is None) != (selected_index is None):
            raise ValueError(
                "oracle selected candidate ID and index must both be set or both be null"
            )

        eligible_scores = [score for score in self.oracle_label.scores if score.eligible]
        if selected_id is None:
            if eligible_scores:
                raise ValueError("oracle selection is required when eligible candidates exist")
            return self

        if selected_id not in candidate_ids:
            raise ValueError("oracle selected candidate ID must reference a candidate")
        assert selected_index is not None
        if selected_index < 0 or selected_index >= len(candidate_ids):
            raise ValueError("selected_candidate_index is out of range")
        if candidate_ids[selected_index] != selected_id:
            raise ValueError("selected_candidate_index does not match selected_candidate_id")

        selected_score = self.oracle_label.scores[selected_index]
        if not selected_score.eligible:
            raise ValueError("oracle selected candidate must be eligible")
        highest_eligible_score = max(score.score for score in eligible_scores)
        if selected_score.score != highest_eligible_score:
            raise ValueError("oracle selected candidate must have the highest eligible score")
        return self

    def as_request(self) -> ParkingDecisionRequest:
        return ParkingDecisionRequest(
            car=self.car,
            destination=self.destination,
            candidates=self.candidates,
            city=self.city,
            weights=self.weights,
        )


def parse_grouped_dataset(path: Path) -> list[GroupedCandidateRecord]:
    records: list[GroupedCandidateRecord] = []
    seen_group_ids: set[int] = set()

    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                sample = SyntheticParkingSample.model_validate_json(line)
            except ValidationError as exc:
                raise ValueError(f"Invalid grouped dataset row {line_number}: {exc}") from exc

            group_id = sample.metadata.sample_index
            if group_id in seen_group_ids:
                raise ValueError(f"Duplicate grouped dataset sample_index: {group_id}")
            seen_group_ids.add(group_id)

            records.extend(
                GroupedCandidateRecord(
                    group_id=group_id,
                    candidate_index=candidate_index,
                    candidate_id=candidate_row.candidate_id,
                    features=candidate_row.features,
                    label=candidate_row.label,
                    eligible=candidate_row.eligible,
                )
                for candidate_index, candidate_row in enumerate(sample.candidate_features)
            )

    return records
