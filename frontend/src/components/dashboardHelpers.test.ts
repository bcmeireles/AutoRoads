import { describe, expect, it } from "vitest";

import type { CarAgent, ScenarioSettings } from "../types";
import {
  decisionModeLabel,
  metricValue,
  normalizedObjectiveWeights,
  routeProgressPercent,
  waitStatus,
} from "./dashboardHelpers";

const settings: ScenarioSettings = {
  trafficDensity: 0.4,
  parkingScarcity: 0.5,
  tripDemand: 0.6,
  driveTimeWeight: 2,
  walkDistanceWeight: 1,
  priceWeight: 1,
  availabilityRiskWeight: 1,
  congestionWeight: 0,
};

const car: CarAgent = {
  id: "car-1",
  color: "#000000",
  position: { x: 0, z: 0 },
  currentNodeId: "n1",
  destinationId: "market",
  path: ["n1", "n2", "n3"],
  pathIndex: 1,
  state: "driving",
  speed: 10,
};

describe("dashboard helpers", () => {
  it("normalizes objective weights for display", () => {
    const weights = normalizedObjectiveWeights(settings);

    expect(weights.find((weight) => weight.key === "driveTimeWeight")?.value).toBeCloseTo(0.4);
    expect(weights.reduce((sum, weight) => sum + weight.value, 0)).toBeCloseTo(1);
  });

  it("falls back to backend default objective weights for zero totals", () => {
    const weights = normalizedObjectiveWeights({
      ...settings,
      driveTimeWeight: 0,
      walkDistanceWeight: 0,
      priceWeight: 0,
      availabilityRiskWeight: 0,
      congestionWeight: 0,
    });

    expect(weights).toEqual([
      { key: "driveTimeWeight", value: 0.35 },
      { key: "walkDistanceWeight", value: 0.25 },
      { key: "priceWeight", value: 0.15 },
      { key: "availabilityRiskWeight", value: 0.15 },
      { key: "congestionWeight", value: 0.1 },
    ]);
    expect(weights.reduce((sum, weight) => sum + weight.value, 0)).toBeCloseTo(1);
  });

  it("formats route progress and waits", () => {
    expect(routeProgressPercent(car)).toBe(50);
    expect(waitStatus(1.25)).toBe("1.3s");
    expect(waitStatus(0)).toBe("clear");
  });

  it("names the decision mode honestly", () => {
    expect(decisionModeLabel(car)).toBe("waiting");
    expect(decisionModeLabel({ ...car, decisionRequested: true })).toBe("pending");
    expect(decisionModeLabel({ ...car, modelVersion: "frontend-fallback" })).toBe("local fallback");
    expect(decisionModeLabel({ ...car, modelVersion: "heuristic-fallback" })).toBe("backend heuristic");
    expect(decisionModeLabel({ ...car, modelVersion: "parking-mlp-local-v1" })).toBe("backend model");
  });

  it("uses fallbacks for missing metric values", () => {
    expect(metricValue(undefined)).toBe("pending");
    expect(metricValue(null, "n/a")).toBe("n/a");
    expect(metricValue(12.4)).toBe("12.4");
  });
});
