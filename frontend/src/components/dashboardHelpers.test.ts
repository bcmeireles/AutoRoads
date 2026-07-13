import { describe, expect, it, vi } from "vitest";

import type { CarAgent, ScenarioSettings } from "../types";
import {
  decisionModeLabel,
  metricValue,
  normalizedObjectiveWeights,
  routeProgressPercent,
  startMetricsPolling,
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

    expect(weights.map(({ key, label, value }) => ({ key, label, value }))).toEqual([
      { key: "driveTimeWeight", label: "Drive time", value: 0.35 },
      { key: "walkDistanceWeight", label: "Walk distance", value: 0.25 },
      { key: "priceWeight", label: "Price", value: 0.15 },
      { key: "availabilityRiskWeight", label: "Availability risk", value: 0.15 },
      { key: "congestionWeight", label: "Congestion", value: 0.1 },
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

describe("metrics polling", () => {
  it("reports a successful metrics load", async () => {
    const metrics = { model_version: "test-v1", trained: true };
    const onLoading = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const controller = startMetricsPolling({
      load: vi.fn().mockResolvedValue(metrics),
      onLoading,
      onSuccess,
      onError,
      intervalMs: 60_000,
    });

    await controller.initialLoad;
    controller.stop();

    expect(onLoading).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(metrics);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failed metrics load", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const controller = startMetricsPolling({
      load: vi.fn().mockRejectedValue(new Error("offline")),
      onLoading: vi.fn(),
      onSuccess,
      onError,
      intervalMs: 60_000,
    });

    await controller.initialLoad;
    controller.stop();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("clears polling and ignores in-flight results after cleanup", async () => {
    let resolveLoad: ((value: string) => void) | undefined;
    let poll: (() => void) | undefined;
    const load = vi.fn(
      () => new Promise<string>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const onSuccess = vi.fn();
    const clearIntervalFn = vi.fn();
    const setIntervalFn = ((callback: () => void) => {
      poll = callback;
      return 42;
    }) as typeof globalThis.setInterval;
    const controller = startMetricsPolling({
      load,
      onLoading: vi.fn(),
      onSuccess,
      onError: vi.fn(),
      setIntervalFn,
      clearIntervalFn,
    });

    controller.stop();
    resolveLoad?.("late metrics");
    await controller.initialLoad;
    poll?.();
    await Promise.resolve();

    expect(clearIntervalFn).toHaveBeenCalledWith(42);
    expect(load).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
