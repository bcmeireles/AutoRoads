from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from backend.app.feature_engineering import FEATURE_NAMES, candidate_feature_vector
from backend.app.oracle import score_candidate
from backend.app.schemas import (
    CarState,
    CityContext,
    Destination,
    ParkingCandidate,
    ParkingDecisionRequest,
    Point,
    PreferenceWeights,
)


DEFAULT_OUTPUT = Path("backend/data/synthetic_parking.jsonl")


def build_sample(rng: random.Random, index: int) -> dict[str, object]:
    destination = Destination(
        id=f"dest-{index % 8}",
        name=f"Destination {index % 8}",
        position=Point(x=rng.uniform(-80, 80), z=rng.uniform(-80, 80)),
        demand=rng.uniform(0.1, 1.0),
    )
    car = CarState(
        id=f"car-{index % 32}",
        position=Point(x=rng.uniform(-100, 100), z=rng.uniform(-100, 100)),
        destination_id=destination.id,
        speed_mps=rng.uniform(6.0, 13.0),
        state="choosing_parking",
    )
    city = CityContext(
        traffic_density=rng.uniform(0.05, 0.95),
        parking_scarcity=rng.uniform(0.05, 0.95),
        trip_demand=rng.uniform(0.05, 0.95),
        signal_delay_seconds=rng.uniform(4, 30),
    )
    weights = PreferenceWeights(
        drive_time=rng.uniform(0.15, 0.55),
        walk_distance=rng.uniform(0.10, 0.45),
        price=rng.uniform(0.05, 0.3),
        availability_risk=rng.uniform(0.05, 0.35),
        congestion=rng.uniform(0.05, 0.3),
    ).normalized()
    candidate = ParkingCandidate(
        id=f"spot-{index}",
        position=Point(
            x=destination.position.x + rng.uniform(-45, 45),
            z=destination.position.z + rng.uniform(-45, 45),
        ),
        drive_eta_seconds=rng.uniform(15, 420) * (1 + city.traffic_density * 0.6),
        walk_distance_meters=rng.uniform(20, 900),
        price=max(0.0, rng.gauss(8, 5)),
        availability=max(0.0, min(1.0, rng.random() - city.parking_scarcity * 0.25)),
        occupancy_risk=max(0.0, min(1.0, rng.random() * (0.6 + city.parking_scarcity))),
        congestion=max(0.0, min(1.0, rng.random() * (0.5 + city.traffic_density))),
        legal=rng.random() > 0.04,
        accessible=rng.random() > 0.08,
    )
    request = ParkingDecisionRequest(
        car=car,
        destination=destination,
        candidates=[candidate],
        city=city,
        weights=weights,
    )
    return {
        "feature_names": FEATURE_NAMES,
        "features": candidate_feature_vector(request, candidate),
        "label": score_candidate(request, candidate),
    }


def generate_dataset(samples: int, seed: int, output: Path) -> Path:
    rng = random.Random(seed)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for index in range(samples):
            handle.write(json.dumps(build_sample(rng, index)) + "\n")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic AutoRoads parking data.")
    parser.add_argument("--samples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = generate_dataset(samples=args.samples, seed=args.seed, output=args.output)
    print(f"Wrote {args.samples} samples to {output}")


if __name__ == "__main__":
    main()

