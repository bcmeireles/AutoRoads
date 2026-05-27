from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Point(BaseModel):
    x: float
    z: float


class PreferenceWeights(BaseModel):
    drive_time: float = Field(0.35, ge=0)
    walk_distance: float = Field(0.25, ge=0)
    price: float = Field(0.15, ge=0)
    availability_risk: float = Field(0.15, ge=0)
    congestion: float = Field(0.10, ge=0)

    def normalized(self) -> "PreferenceWeights":
        total = (
            self.drive_time
            + self.walk_distance
            + self.price
            + self.availability_risk
            + self.congestion
        )
        if total <= 0:
            return PreferenceWeights()
        return PreferenceWeights(
            drive_time=self.drive_time / total,
            walk_distance=self.walk_distance / total,
            price=self.price / total,
            availability_risk=self.availability_risk / total,
            congestion=self.congestion / total,
        )


class CarState(BaseModel):
    id: str
    position: Point
    destination_id: str
    speed_mps: float = Field(9.0, ge=0)
    state: Literal[
        "spawned",
        "routing",
        "driving",
        "choosing_parking",
        "parking",
        "parked",
        "blocked",
    ] = "driving"


class Destination(BaseModel):
    id: str
    name: str
    position: Point
    demand: float = Field(0.5, ge=0, le=1)


class ParkingCandidate(BaseModel):
    id: str
    position: Point
    drive_eta_seconds: float = Field(..., ge=0)
    walk_distance_meters: float = Field(..., ge=0)
    price: float = Field(..., ge=0)
    availability: float = Field(..., ge=0, le=1)
    occupancy_risk: float = Field(..., ge=0, le=1)
    congestion: float = Field(..., ge=0, le=1)
    legal: bool = True
    accessible: bool = True


class CityContext(BaseModel):
    traffic_density: float = Field(0.4, ge=0, le=1)
    parking_scarcity: float = Field(0.4, ge=0, le=1)
    trip_demand: float = Field(0.4, ge=0, le=1)
    signal_delay_seconds: float = Field(12.0, ge=0)


class ParkingDecisionRequest(BaseModel):
    car: CarState
    destination: Destination
    candidates: list[ParkingCandidate] = Field(..., min_length=1)
    city: CityContext = Field(default_factory=CityContext)
    weights: PreferenceWeights = Field(default_factory=PreferenceWeights)


class CandidateScore(BaseModel):
    spot_id: str
    score: float
    eligible: bool
    rank: int


class BaselinePick(BaseModel):
    strategy: Literal["nearest", "random"]
    spot_id: str | None
    score: float | None


class ExplanationTerm(BaseModel):
    feature: str
    impact: float
    direction: Literal["helps", "hurts"]
    detail: str


class ParkingDecisionResponse(BaseModel):
    selected_spot_id: str | None
    candidate_scores: list[CandidateScore]
    baselines: list[BaselinePick]
    explanation: list[ExplanationTerm]
    model_version: str


class HealthResponse(BaseModel):
    ok: bool
    model_version: str


class ModelMetricsResponse(BaseModel):
    model_version: str
    trained: bool
    parking_outcome_score: float | None = None
    nearest_baseline_score: float | None = None
    random_baseline_score: float | None = None
    model_delta_vs_nearest: float | None = None
    model_delta_vs_random: float | None = None
    samples: int | None = None

