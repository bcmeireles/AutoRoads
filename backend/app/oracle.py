from __future__ import annotations

import random

from backend.app.schemas import ParkingCandidate, ParkingDecisionRequest


INELIGIBLE_SCORE = -1_000_000.0


def is_eligible(candidate: ParkingCandidate) -> bool:
    return candidate.legal and candidate.accessible and candidate.availability > 0.05


def score_candidate(request: ParkingDecisionRequest, candidate: ParkingCandidate) -> float:
    if not is_eligible(candidate):
        return INELIGIBLE_SCORE

    weights = request.weights.normalized()
    drive_cost = candidate.drive_eta_seconds / 9.0
    walk_cost = candidate.walk_distance_meters / 8.0
    price_cost = candidate.price * 4.0
    availability_cost = (candidate.occupancy_risk + 1.0 - candidate.availability) * 55.0
    congestion_cost = (
        candidate.congestion * 55.0
        + request.city.traffic_density * 25.0
        + request.city.signal_delay_seconds * 0.3
    )
    demand_penalty = request.destination.demand * request.city.trip_demand * 14.0

    weighted_cost = (
        weights.drive_time * drive_cost
        + weights.walk_distance * walk_cost
        + weights.price * price_cost
        + weights.availability_risk * availability_cost
        + weights.congestion * congestion_cost
        + demand_penalty
    )
    return round(100.0 - weighted_cost, 4)


def nearest_baseline(
    request: ParkingDecisionRequest,
) -> tuple[ParkingCandidate | None, float | None]:
    eligible = [candidate for candidate in request.candidates if is_eligible(candidate)]
    if not eligible:
        return None, None
    choice = min(
        eligible,
        key=lambda candidate: (
            candidate.walk_distance_meters,
            candidate.drive_eta_seconds,
            candidate.price,
        ),
    )
    return choice, score_candidate(request, choice)


def random_baseline(
    request: ParkingDecisionRequest,
) -> tuple[ParkingCandidate | None, float | None]:
    eligible = [candidate for candidate in request.candidates if is_eligible(candidate)]
    if not eligible:
        return None, None
    rng = random.Random(f"{request.car.id}:{request.destination.id}:{len(eligible)}")
    choice = rng.choice(eligible)
    return choice, score_candidate(request, choice)

