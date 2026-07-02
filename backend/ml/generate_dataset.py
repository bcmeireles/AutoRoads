from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from backend.app.feature_engineering import FEATURE_NAMES, candidate_feature_vector
from backend.app.oracle import is_eligible, score_candidate
from backend.app.schemas import (
    CarState,
    CityContext,
    Destination,
    ParkingCandidate,
    ParkingDecisionRequest,
    Point,
    PreferenceWeights,
)
from backend.ml.dataset_schema import (
    CandidateFeatureRow,
    DatasetMetadata,
    OracleCandidateScore,
    OracleLabel,
    SyntheticParkingSample,
)


DEFAULT_OUTPUT = Path("backend/data/synthetic_parking.jsonl")
DEFAULT_SAMPLES = 5000
PREVIEW_SAMPLES = 5

SCENARIO_PROFILES = (
    "balanced",
    "full_lots",
    "illegal_spots",
    "inaccessible_spots",
    "high_congestion",
    "high_price",
    "far_walk_short_drive",
    "short_walk_high_risk",
)


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _near_destination(rng: random.Random, destination: Destination, radius: float) -> Point:
    return Point(
        x=destination.position.x + rng.uniform(-radius, radius),
        z=destination.position.z + rng.uniform(-radius, radius),
    )


def _build_destination(rng: random.Random, index: int) -> Destination:
    destination_id = f"dest-{index % 12}"
    return Destination(
        id=destination_id,
        name=f"Destination {index % 12}",
        position=Point(x=rng.uniform(-90.0, 90.0), z=rng.uniform(-90.0, 90.0)),
        demand=rng.uniform(0.15, 0.95),
    )


def _build_car(rng: random.Random, index: int, destination: Destination) -> CarState:
    return CarState(
        id=f"car-{index % 64}",
        position=Point(x=rng.uniform(-120.0, 120.0), z=rng.uniform(-120.0, 120.0)),
        destination_id=destination.id,
        speed_mps=rng.uniform(6.0, 13.5),
        state="choosing_parking",
    )


def _build_city(rng: random.Random, profile: str) -> CityContext:
    if profile == "high_congestion":
        return CityContext(
            traffic_density=rng.uniform(0.86, 1.0),
            parking_scarcity=rng.uniform(0.45, 0.85),
            trip_demand=rng.uniform(0.65, 1.0),
            signal_delay_seconds=rng.uniform(24.0, 48.0),
        )
    if profile == "full_lots":
        return CityContext(
            traffic_density=rng.uniform(0.35, 0.8),
            parking_scarcity=rng.uniform(0.9, 1.0),
            trip_demand=rng.uniform(0.5, 0.95),
            signal_delay_seconds=rng.uniform(10.0, 35.0),
        )
    return CityContext(
        traffic_density=rng.uniform(0.05, 0.85),
        parking_scarcity=rng.uniform(0.05, 0.85),
        trip_demand=rng.uniform(0.05, 0.95),
        signal_delay_seconds=rng.uniform(4.0, 30.0),
    )


def _build_weights(rng: random.Random, profile: str) -> PreferenceWeights:
    if profile == "high_price":
        weights = PreferenceWeights(
            drive_time=rng.uniform(0.15, 0.35),
            walk_distance=rng.uniform(0.1, 0.3),
            price=rng.uniform(0.28, 0.5),
            availability_risk=rng.uniform(0.05, 0.22),
            congestion=rng.uniform(0.05, 0.2),
        )
    elif profile == "far_walk_short_drive":
        weights = PreferenceWeights(
            drive_time=rng.uniform(0.3, 0.5),
            walk_distance=rng.uniform(0.25, 0.5),
            price=rng.uniform(0.05, 0.2),
            availability_risk=rng.uniform(0.05, 0.2),
            congestion=rng.uniform(0.05, 0.2),
        )
    elif profile == "short_walk_high_risk":
        weights = PreferenceWeights(
            drive_time=rng.uniform(0.12, 0.3),
            walk_distance=rng.uniform(0.2, 0.45),
            price=rng.uniform(0.05, 0.2),
            availability_risk=rng.uniform(0.25, 0.5),
            congestion=rng.uniform(0.05, 0.18),
        )
    else:
        weights = PreferenceWeights(
            drive_time=rng.uniform(0.15, 0.55),
            walk_distance=rng.uniform(0.1, 0.45),
            price=rng.uniform(0.05, 0.3),
            availability_risk=rng.uniform(0.05, 0.35),
            congestion=rng.uniform(0.05, 0.3),
        )
    return weights.normalized()


def _base_candidate(
    rng: random.Random,
    index: int,
    candidate_index: int,
    destination: Destination,
    city: CityContext,
) -> ParkingCandidate:
    parking_pressure = city.parking_scarcity * rng.uniform(0.1, 0.45)
    traffic_pressure = city.traffic_density * rng.uniform(0.1, 0.45)
    return ParkingCandidate(
        id=f"spot-{index:05d}-{candidate_index}",
        position=_near_destination(rng, destination, rng.uniform(25.0, 120.0)),
        drive_eta_seconds=rng.uniform(20.0, 520.0) * (1.0 + city.traffic_density * 0.55),
        walk_distance_meters=rng.uniform(20.0, 950.0),
        price=rng.uniform(0.0, 24.0),
        availability=_clamp(rng.uniform(0.15, 0.98) - parking_pressure),
        occupancy_risk=_clamp(rng.uniform(0.02, 0.72) + parking_pressure),
        congestion=_clamp(rng.uniform(0.02, 0.7) + traffic_pressure),
        legal=rng.random() > 0.04,
        accessible=rng.random() > 0.06,
    )


def _profile_candidate(
    rng: random.Random,
    profile: str,
    candidate: ParkingCandidate,
    candidate_index: int,
) -> ParkingCandidate:
    updates: dict[str, object] = {}

    if profile == "full_lots":
        updates.update(
            availability=rng.uniform(0.0, 0.045),
            occupancy_risk=rng.uniform(0.86, 1.0),
            legal=True,
            accessible=True,
        )
    elif profile == "illegal_spots":
        illegal = candidate_index in {0, 2}
        updates.update(legal=not illegal, accessible=True)
        if illegal:
            updates.update(
                drive_eta_seconds=rng.uniform(18.0, 60.0),
                walk_distance_meters=rng.uniform(12.0, 75.0),
                price=rng.uniform(0.0, 5.0),
                availability=rng.uniform(0.72, 1.0),
                occupancy_risk=rng.uniform(0.0, 0.2),
            )
    elif profile == "inaccessible_spots":
        inaccessible = candidate_index in {0, 1}
        updates.update(accessible=not inaccessible, legal=True)
        if inaccessible:
            updates.update(
                drive_eta_seconds=rng.uniform(22.0, 75.0),
                walk_distance_meters=rng.uniform(8.0, 55.0),
                price=rng.uniform(1.0, 8.0),
                availability=rng.uniform(0.65, 0.98),
                occupancy_risk=rng.uniform(0.0, 0.28),
            )
    elif profile == "high_congestion":
        updates.update(
            drive_eta_seconds=rng.uniform(260.0, 780.0),
            congestion=rng.uniform(0.78, 1.0),
        )
    elif profile == "high_price":
        if candidate_index in {0, 1, 2}:
            updates.update(
                walk_distance_meters=rng.uniform(15.0, 120.0),
                price=rng.uniform(34.0, 78.0),
                availability=rng.uniform(0.55, 0.98),
            )
        else:
            updates.update(price=rng.uniform(8.0, 26.0))
    elif profile == "far_walk_short_drive" and candidate_index in {0, 1}:
        updates.update(
            drive_eta_seconds=rng.uniform(16.0, 48.0),
            walk_distance_meters=rng.uniform(850.0, 1600.0),
            price=rng.uniform(0.0, 8.0),
            availability=rng.uniform(0.55, 0.98),
            occupancy_risk=rng.uniform(0.03, 0.35),
        )
    elif profile == "short_walk_high_risk" and candidate_index in {0, 1}:
        updates.update(
            walk_distance_meters=rng.uniform(8.0, 45.0),
            availability=rng.uniform(0.06, 0.2),
            occupancy_risk=rng.uniform(0.84, 1.0),
            congestion=rng.uniform(0.05, 0.55),
            legal=True,
            accessible=True,
        )

    return candidate.model_copy(update=updates)


def _build_candidates(
    rng: random.Random,
    index: int,
    profile: str,
    destination: Destination,
    city: CityContext,
) -> list[ParkingCandidate]:
    count = rng.randint(4, 8)
    return [
        _profile_candidate(
            rng,
            profile,
            _base_candidate(rng, index, candidate_index, destination, city),
            candidate_index,
        )
        for candidate_index in range(count)
    ]


def _build_oracle_label(request: ParkingDecisionRequest) -> OracleLabel:
    scored = [
        (candidate, is_eligible(candidate), score_candidate(request, candidate))
        for candidate in request.candidates
    ]
    ranked_ids = {
        candidate.id: rank
        for rank, (candidate, _eligible, _score) in enumerate(
            sorted(scored, key=lambda item: item[2], reverse=True),
            start=1,
        )
    }
    scores = [
        OracleCandidateScore(
            candidate_id=candidate.id,
            score=score,
            eligible=eligible,
            rank=ranked_ids[candidate.id],
        )
        for candidate, eligible, score in scored
    ]
    eligible_scored = [item for item in scored if item[1]]
    if not eligible_scored:
        return OracleLabel(
            selected_candidate_id=None,
            selected_candidate_index=None,
            scores=scores,
        )

    selected_candidate = max(eligible_scored, key=lambda item: item[2])[0]
    return OracleLabel(
        selected_candidate_id=selected_candidate.id,
        selected_candidate_index=request.candidates.index(selected_candidate),
        scores=scores,
    )


def build_sample(rng: random.Random, index: int, seed: int) -> SyntheticParkingSample:
    profile = SCENARIO_PROFILES[index % len(SCENARIO_PROFILES)]
    destination = _build_destination(rng, index)
    car = _build_car(rng, index, destination)
    city = _build_city(rng, profile)
    weights = _build_weights(rng, profile)
    candidates = _build_candidates(rng, index, profile, destination, city)
    request = ParkingDecisionRequest(
        car=car,
        destination=destination,
        candidates=candidates,
        city=city,
        weights=weights,
    )
    candidate_features = [
        CandidateFeatureRow(
            candidate_id=candidate.id,
            features=candidate_feature_vector(request, candidate),
            label=score_candidate(request, candidate),
            eligible=is_eligible(candidate),
        )
        for candidate in candidates
    ]
    return SyntheticParkingSample(
        metadata=DatasetMetadata(
            seed=seed,
            sample_index=index,
            scenario_profile=profile,
            candidate_ids=[candidate.id for candidate in candidates],
        ),
        feature_names=FEATURE_NAMES,
        car=car,
        destination=destination,
        city=city,
        weights=weights,
        candidates=candidates,
        candidate_features=candidate_features,
        oracle_label=_build_oracle_label(request),
    )


def generate_dataset(samples: int, seed: int, output: Path) -> Path:
    if samples < 1:
        raise ValueError("samples must be at least 1")

    rng = random.Random(seed)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for index in range(samples):
            sample = build_sample(rng, index, seed)
            handle.write(json.dumps(sample.model_dump(mode="json")) + "\n")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic AutoRoads parking data.")
    parser.add_argument("--samples", type=int, default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--preview",
        action="store_true",
        help=f"Generate a small {PREVIEW_SAMPLES}-sample dataset unless --samples is set.",
    )
    args = parser.parse_args()
    samples = args.samples
    if samples is None:
        samples = PREVIEW_SAMPLES if args.preview else DEFAULT_SAMPLES
    output = generate_dataset(samples=samples, seed=args.seed, output=args.output)
    preview = " preview" if args.preview else ""
    print(f"Wrote {samples}{preview} samples to {output}")


if __name__ == "__main__":
    main()
