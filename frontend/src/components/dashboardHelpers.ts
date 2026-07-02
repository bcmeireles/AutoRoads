import type { CarAgent, ScenarioSettings } from "../types";

const objectiveKeys = [
  "driveTimeWeight",
  "walkDistanceWeight",
  "priceWeight",
  "availabilityRiskWeight",
  "congestionWeight",
] as const;

export function normalizedObjectiveWeights(settings: ScenarioSettings) {
  const total = objectiveKeys.reduce((sum, key) => sum + settings[key], 0);
  return objectiveKeys.map((key) => ({
    key,
    value: total > 0 ? settings[key] / total : 0,
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
  if (car.modelVersion) return "backend model";
  if (!car.decisionRequested && !car.chosenSpotId) return "waiting";
  return "pending";
}

export function metricValue(value: string | number | undefined | null, fallback = "pending"): string {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}
