import type {
  CandidateScore,
  CarAgent,
  CityMap,
  Destination,
  ExplanationTerm,
  ScenarioSettings,
} from "../types";
import { distanceMeters, estimateRouteSeconds, findRoute } from "../sim/routing";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export type ParkingDecision = {
  selected_spot_id: string | null;
  candidate_scores: CandidateScore[];
  baselines: { strategy: "nearest" | "random"; spot_id: string | null; score: number | null }[];
  explanation: ExplanationTerm[];
  model_version: string;
};

export async function decideParking(
  city: CityMap,
  car: CarAgent,
  destination: Destination,
  settings: ScenarioSettings,
): Promise<ParkingDecision> {
  const response = await fetch(`${API_BASE}/parking/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      car: {
        id: car.id,
        position: car.position,
        destination_id: car.destinationId,
        speed_mps: car.speed,
        state: "choosing_parking",
      },
      destination: {
        id: destination.id,
        name: destination.name,
        position: destination.position,
        demand: Math.min(1, destination.demand + settings.tripDemand * 0.15),
      },
      city: {
        traffic_density: settings.trafficDensity,
        parking_scarcity: settings.parkingScarcity,
        trip_demand: settings.tripDemand,
        signal_delay_seconds: 8 + settings.trafficDensity * 20,
      },
      weights: {
        drive_time: settings.driveTimeWeight,
        walk_distance: settings.walkDistanceWeight,
        price: settings.priceWeight,
        availability_risk: settings.availabilityRiskWeight,
        congestion: settings.congestionWeight,
      },
      candidates: buildCandidates(city, car, destination, settings),
    }),
  });

  if (!response.ok) {
    throw new Error(`Parking API failed with ${response.status}`);
  }
  return response.json() as Promise<ParkingDecision>;
}

export function buildCandidates(
  city: CityMap,
  car: CarAgent,
  destination: Destination,
  settings: ScenarioSettings,
) {
  return city.parkingSpots.map((spot) => {
    const path = findRoute(city, car.currentNodeId, spot.nodeId);
    return {
      id: spot.id,
      position: spot.position,
      drive_eta_seconds:
        estimateRouteSeconds(city, path, settings.trafficDensity) || 999,
      walk_distance_meters: distanceMeters(spot.position, destination.position),
      price: spot.price,
      availability: Math.max(0, spot.baseAvailability - settings.parkingScarcity * 0.45),
      occupancy_risk: Math.min(1, spot.occupancyRisk + settings.parkingScarcity * 0.35),
      congestion: Math.min(1, settings.trafficDensity * 0.7 + settings.tripDemand * 0.25),
      legal: spot.legal,
      accessible: spot.accessible,
    };
  });
}

export function localFallbackDecision(
  city: CityMap,
  car: CarAgent,
  destination: Destination,
  settings: ScenarioSettings,
): ParkingDecision {
  const candidates = buildCandidates(city, car, destination, settings)
    .filter((candidate) => candidate.legal && candidate.accessible && candidate.availability > 0.05)
    .sort(
      (a, b) =>
        a.walk_distance_meters +
        a.drive_eta_seconds * 0.25 +
        a.price * 12 -
        (b.walk_distance_meters + b.drive_eta_seconds * 0.25 + b.price * 12),
    );
  const selected = candidates[0]?.id ?? null;
  return {
    selected_spot_id: selected,
    candidate_scores: candidates.map((candidate, index) => ({
      spot_id: candidate.id,
      score: 100 - index * 8,
      eligible: true,
      rank: index + 1,
    })),
    baselines: [
      { strategy: "nearest", spot_id: selected, score: candidates.length ? 100 : null },
      {
        strategy: "random",
        spot_id: candidates[candidates.length - 1]?.id ?? null,
        score: candidates.length ? 64 : null,
      },
    ],
    explanation: [
      {
        feature: "local_fallback",
        impact: -1,
        direction: "hurts",
        detail: "Backend unavailable; using local nearest-cost baseline.",
      },
    ],
    model_version: "frontend-fallback",
  };
}
