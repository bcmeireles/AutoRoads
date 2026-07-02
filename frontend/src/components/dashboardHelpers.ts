import type { CarAgent, ScenarioSettings } from "../types";

const objectiveKeys = [
  "driveTimeWeight",
  "walkDistanceWeight",
  "priceWeight",
  "availabilityRiskWeight",
  "congestionWeight",
] as const;

const defaultObjectiveWeights: Record<(typeof objectiveKeys)[number], number> = {
  driveTimeWeight: 0.35,
  walkDistanceWeight: 0.25,
  priceWeight: 0.15,
  availabilityRiskWeight: 0.15,
  congestionWeight: 0.1,
};

export function normalizedObjectiveWeights(settings: ScenarioSettings) {
  const total = objectiveKeys.reduce((sum, key) => sum + settings[key], 0);
  if (total <= 0) {
    return objectiveKeys.map((key) => ({
      key,
      value: defaultObjectiveWeights[key],
    }));
  }

  return objectiveKeys.map((key) => ({
    key,
    value: settings[key] / total,
  }));
}

export function routeProgressPercent(car: CarAgent): number {
  if (car.path.length <= 1) return 100;
  return Math.min(100, Math.max(0, (car.pathIndex / (car.path.length - 1)) * 100));
}

export function waitStatus(waitSeconds?: number): string {
  if (!waitSeconds || waitSeconds <= 0) return "clear";
  return `${waitSeconds.toFixed(1)}s`;
}

export function decisionModeLabel(car: CarAgent): string {
  if (car.modelVersion === "frontend-fallback") return "local fallback";
  if (car.modelVersion === "heuristic-fallback") return "backend heuristic";
  if (car.modelVersion) return "backend model";
  if (!car.decisionRequested && !car.chosenSpotId) return "waiting";
  return "pending";
}

export function metricValue(value: string | number | undefined | null, fallback = "pending"): string {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}
