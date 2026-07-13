import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialCars } from "../sim/city";
import type { CarAgent } from "../types";
import { useSimulationStore } from "./simulationStore";

const decision = (selectedSpotId: string | null = "p2") => ({
  selected_spot_id: selectedSpotId,
  candidate_scores: selectedSpotId
    ? [{ spot_id: selectedSpotId, score: 84, eligible: true, rank: 1 }]
    : [],
  baselines: [
    { strategy: "nearest", spot_id: "p1", score: 80 },
    { strategy: "random", spot_id: "p3", score: 62 },
  ],
  explanation: [
    {
      feature: "walk_distance",
      impact: -0.4,
      direction: "hurts",
      detail: "Longer walk",
    },
  ],
  model_version: "parking-test-v1",
});

const choosingCar = (overrides: Partial<CarAgent> = {}): CarAgent => ({
  ...initialCars[0],
  position: { ...initialCars[0].position },
  path: [initialCars[0].currentNodeId],
  pathIndex: 0,
  state: "choosing_parking",
  decisionRequested: true,
  parkingDecisionStatus: "pending",
  ...overrides,
});

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("parking decision integration", () => {
  beforeEach(() => {
    useSimulationStore.getState().reset();
    useSimulationStore.setState({ cars: [choosingCar()] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useSimulationStore.getState().reset();
  });

  it("applies a backend decision and preserves both baselines", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(decision()));
    vi.stubGlobal("fetch", fetchMock);

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars[0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(car.state).toBe("parking");
    expect(car.parkingDecisionStatus).toBe("backend");
    expect(car.parkingDecisionError).toBeUndefined();
    expect(car.chosenSpotId).toBe("p2");
    expect(car.baselineSpotId).toBe("p1");
    expect(car.randomBaselineSpotId).toBe("p3");
    expect(car.modelVersion).toBe("parking-test-v1");
    expect(car.candidateScores).toHaveLength(1);
    expect(car.decisionRequested).toBe(false);
  });

  it("uses and exposes the local fallback after an HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars[0];
    expect(car.state).toBe("parking");
    expect(car.parkingDecisionStatus).toBe("fallback");
    expect(car.parkingDecisionError).toContain("500");
    expect(car.modelVersion).toBe("frontend-fallback");
    expect(car.randomBaselineSpotId).toBeDefined();
  });

  it("blocks visibly when the backend selects no eligible spot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(decision(null))));

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars[0];
    expect(car.state).toBe("blocked");
    expect(car.parkingDecisionStatus).toBe("blocked");
    expect(car.parkingDecisionError).toBe("No eligible parking spot was selected.");
  });

  it("blocks visibly when the selected spot does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(decision("missing-spot"))));

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars[0];
    expect(car.state).toBe("blocked");
    expect(car.parkingDecisionError).toContain("does not exist");
  });

  it("blocks visibly when no route reaches the selected spot", async () => {
    useSimulationStore.setState({
      cars: [choosingCar({ currentNodeId: "missing-node" })],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(decision("p1"))));

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars[0];
    expect(car.state).toBe("blocked");
    expect(car.parkingDecisionError).toContain("No route exists");
  });

  it("deduplicates concurrent requests for the same car", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal("fetch", fetchMock);

    const first = useSimulationStore.getState().requestParkingDecision("car-1");
    const second = useSimulationStore.getState().requestParkingDecision("car-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse?.(jsonResponse(decision()));
    await Promise.all([first, second]);
    expect(useSimulationStore.getState().cars[0].parkingDecisionStatus).toBe("backend");
  });

  it("ignores a stale response after reset", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => response));

    const pending = useSimulationStore.getState().requestParkingDecision("car-1");
    useSimulationStore.getState().reset();
    resolveResponse?.(jsonResponse(decision()));
    await pending;

    const car = useSimulationStore.getState().cars.find((candidate) => candidate.id === "car-1")!;
    expect(car.state).toBe("driving");
    expect(car.chosenSpotId).toBeUndefined();
  });
});
