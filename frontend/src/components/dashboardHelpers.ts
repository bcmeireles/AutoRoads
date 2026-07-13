import type { CarAgent, ScenarioSettings } from "../types";

const objectives = [
  { key: "driveTimeWeight", label: "Drive time", shortLabel: "Drive" },
  { key: "walkDistanceWeight", label: "Walk distance", shortLabel: "Walk" },
  { key: "priceWeight", label: "Price", shortLabel: "Price" },
  { key: "availabilityRiskWeight", label: "Availability risk", shortLabel: "Avail." },
  { key: "congestionWeight", label: "Congestion", shortLabel: "Cong." },
] as const;

const defaultObjectiveWeights: Record<(typeof objectives)[number]["key"], number> = {
  driveTimeWeight: 0.35,
  walkDistanceWeight: 0.25,
  priceWeight: 0.15,
  availabilityRiskWeight: 0.15,
  congestionWeight: 0.1,
};

export function normalizedObjectiveWeights(settings: ScenarioSettings) {
  const total = objectives.reduce((sum, objective) => sum + settings[objective.key], 0);
  if (total <= 0) {
    return objectives.map((objective) => ({
      ...objective,
      value: defaultObjectiveWeights[objective.key],
    }));
  }

  return objectives.map((objective) => ({
    ...objective,
    value: settings[objective.key] / total,
  }));
}

type MetricsPollingOptions<T> = {
  load: () => Promise<T>;
  onLoading: () => void;
  onSuccess: (value: T) => void;
  onError: () => void;
  intervalMs?: number;
  setIntervalFn?: typeof globalThis.setInterval;
  clearIntervalFn?: typeof globalThis.clearInterval;
};

export type MetricsPollingController = {
  initialLoad: Promise<void>;
  refresh: () => Promise<void>;
  stop: () => void;
};

export function startMetricsPolling<T>({
  load,
  onLoading,
  onSuccess,
  onError,
  intervalMs = 30_000,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
}: MetricsPollingOptions<T>): MetricsPollingController {
  let active = true;

  const refresh = async () => {
    if (!active) return;
    onLoading();
    try {
      const value = await load();
      if (active) onSuccess(value);
    } catch {
      if (active) onError();
    }
  };

  const initialLoad = refresh();
  const interval = setIntervalFn(() => void refresh(), intervalMs);

  return {
    initialLoad,
    refresh,
    stop: () => {
      active = false;
      clearIntervalFn(interval);
    },
  };
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
