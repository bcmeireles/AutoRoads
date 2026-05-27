from __future__ import annotations

from collections import OrderedDict

from backend.app.schemas import ParkingCandidate, ParkingDecisionRequest


FEATURE_NAMES = [
    "drive_eta_norm",
    "walk_distance_norm",
    "price_norm",
    "unavailability",
    "occupancy_risk",
    "candidate_congestion",
    "illegal",
    "inaccessible",
    "destination_demand",
    "traffic_density",
    "parking_scarcity",
    "trip_demand",
    "weight_drive_time",
    "weight_walk_distance",
    "weight_price",
    "weight_availability_risk",
    "weight_congestion",
]


def candidate_feature_map(
    request: ParkingDecisionRequest,
    candidate: ParkingCandidate,
) -> OrderedDict[str, float]:
    weights = request.weights.normalized()
    return OrderedDict(
        [
            ("drive_eta_norm", min(candidate.drive_eta_seconds / 900.0, 2.0)),
            ("walk_distance_norm", min(candidate.walk_distance_meters / 1200.0, 2.0)),
            ("price_norm", min(candidate.price / 40.0, 2.0)),
            ("unavailability", 1.0 - candidate.availability),
            ("occupancy_risk", candidate.occupancy_risk),
            ("candidate_congestion", candidate.congestion),
            ("illegal", 0.0 if candidate.legal else 1.0),
            ("inaccessible", 0.0 if candidate.accessible else 1.0),
            ("destination_demand", request.destination.demand),
            ("traffic_density", request.city.traffic_density),
            ("parking_scarcity", request.city.parking_scarcity),
            ("trip_demand", request.city.trip_demand),
            ("weight_drive_time", weights.drive_time),
            ("weight_walk_distance", weights.walk_distance),
            ("weight_price", weights.price),
            ("weight_availability_risk", weights.availability_risk),
            ("weight_congestion", weights.congestion),
        ]
    )


def candidate_feature_vector(
    request: ParkingDecisionRequest,
    candidate: ParkingCandidate,
) -> list[float]:
    feature_map = candidate_feature_map(request, candidate)
    return [feature_map[name] for name in FEATURE_NAMES]

