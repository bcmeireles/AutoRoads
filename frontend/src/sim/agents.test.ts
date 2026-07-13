import { afterEach, describe, expect, it, vi } from "vitest";

import { useSimulationStore } from "../state/simulationStore";
import type { CarAgent, CityMap, ScenarioSettings } from "../types";
import {
  applyParkingDecisionToCar,
  transitionCarAgent,
  transitionCarAgents,
} from "./agents";
import { city } from "./city";

const scenario: ScenarioSettings = {
  trafficDensity: 0.2,
  parkingScarcity: 0.2,
  tripDemand: 0.4,
  driveTimeWeight: 0.35,
  walkDistanceWeight: 0.25,
  priceWeight: 0.15,
  availabilityRiskWeight: 0.15,
  congestionWeight: 0.1,
};

const carAt = (nodeId: string, overrides: Partial<CarAgent> = {}): CarAgent => {
  const node = city.nodes.find((candidate) => candidate.id === nodeId)!;
  return {
    id: "car-test",
    color: "#ffffff",
    position: { ...node.position },
    currentNodeId: nodeId,
    destinationId: "market",
    path: [],
    pathIndex: 0,
    state: "spawned",
    speed: 12,
    ...overrides,
  };
};

const transition = (car: CarAgent, overrides: Partial<Parameters<typeof transitionCarAgent>[0]> = {}) =>
  transitionCarAgent({
    car,
    city,
    scenario,
    elapsedSeconds: 1,
    delta: 0.25,
    ...overrides,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useSimulationStore.getState().reset();
});

describe("transitionCarAgent", () => {
  it("moves spawned cars into routing", () => {
    const result = transition(carAt("n1"));

    expect(result.car.state).toBe("routing");
    expect(result.sideEffect).toBeUndefined();
  });

  it("routes cars and starts driving", () => {
    const result = transition(carAt("n1", { state: "routing" }));

    expect(result.car.state).toBe("driving");
    expect(result.car.path[0]).toBe("n1");
    expect(result.car.path.at(-1)).toBe("n7");
    expect(result.car.pathIndex).toBe(0);
  });

  it("advances driving cars deterministically", () => {
    const car = carAt("n1", {
      state: "driving",
      path: ["n1", "n2"],
      speed: 10,
    });
    const result = transition(car, { delta: 1 });

    expect(result.car.state).toBe("driving");
    expect(result.car.position.x).toBeGreaterThan(car.position.x);
    expect(result.car.position.z).toBe(car.position.z);
  });

  it("requests parking after completing a destination route", () => {
    const result = transition(
      carAt("n7", {
        state: "driving",
        path: ["n7"],
        pathIndex: 0,
      }),
      { elapsedSeconds: 3.5 },
    );

    expect(result.car.state).toBe("choosing_parking");
    expect(result.car.decisionRequested).toBe(true);
    expect(result.car.parkingDecisionRequestId).toBe("parking-car-test-3500");
    expect(result.sideEffect).toEqual({
      type: "requestParkingDecision",
      carId: "car-test",
      requestId: "parking-car-test-3500",
    });
  });

  it("does not enqueue duplicate parking decisions while one is pending", () => {
    const result = transition(
      carAt("n7", {
        state: "choosing_parking",
        decisionRequested: true,
        parkingDecisionRequestId: "parking-car-test-3500",
      }),
    );

    expect(result.car.state).toBe("choosing_parking");
    expect(result.car.parkingDecisionRequestId).toBe("parking-car-test-3500");
    expect(result.sideEffect).toBeUndefined();
  });

  it("applies a parking decision, parks, and then stays parked", () => {
    const parkingCar = applyParkingDecisionToCar(
      carAt("n7", {
        state: "choosing_parking",
        path: ["n7"],
        decisionRequested: true,
        parkingDecisionRequestId: "parking-car-test-3500",
      }),
      city,
      {
        selected_spot_id: "p3",
        candidate_scores: [{ spot_id: "p3", score: 98, eligible: true, rank: 1 }],
        baselines: [{ strategy: "nearest", spot_id: "p3", score: 98 }],
        explanation: [],
        model_version: "test-model",
      },
    );
    const parked = transition(parkingCar).car;
    const stable = transition(parked).car;

    expect(parkingCar.state).toBe("parking");
    expect(parkingCar.path).toEqual(["n7"]);
    expect(parked.state).toBe("parked");
    expect(parked.position).toEqual(city.parkingSpots.find((spot) => spot.id === "p3")!.position);
    expect(stable).toBe(parked);
  });

  it("blocks cars when no destination route exists", () => {
    const disconnectedCity: CityMap = {
      nodes: [
        { id: "a", position: { x: 0, z: 0 } },
        { id: "b", position: { x: 10, z: 0 } },
      ],
      edges: [],
      buildings: [],
      destinations: [
        {
          id: "isolated",
          name: "Isolated",
          nodeId: "b",
          position: { x: 10, z: 0 },
          demand: 0.1,
        },
      ],
      parkingSpots: [],
    };

    const result = transitionCarAgent({
      car: {
        ...carAt("n1", {
          currentNodeId: "a",
          destinationId: "isolated",
          position: { x: 0, z: 0 },
          state: "routing",
        }),
      },
      city: disconnectedCity,
      scenario,
      elapsedSeconds: 0,
      delta: 0.1,
    });

    expect(result.car.state).toBe("blocked");
    expect(result.sideEffect).toBeUndefined();
  });

  it("keeps one blocked car from poisoning the rest of the simulation", () => {
    const result = transitionCarAgents({
      cars: [
        carAt("n1", { id: "blocked-car", state: "blocked" }),
        carAt("n1", { id: "active-car", state: "routing" }),
      ],
      city,
      scenario,
      elapsedSeconds: 1,
      delta: 0.25,
    });

    expect(result.cars.find((car) => car.id === "blocked-car")?.state).toBe("blocked");
    expect(result.cars.find((car) => car.id === "active-car")?.state).toBe("driving");
  });
});

describe("parking decision requests", () => {
  it("uses the frontend fallback when the backend decision fails", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("backend offline")));
    vi.stubGlobal("fetch", fetchMock);
    useSimulationStore.setState({
      elapsedSeconds: 3.5,
      selectedCarId: "car-test",
      paused: false,
      scenario,
      cars: [
        carAt("n7", {
          state: "choosing_parking",
          path: ["n7"],
          decisionRequested: true,
          parkingDecisionRequestId: "parking-car-test-3500",
        }),
      ],
    });

    await useSimulationStore.getState().requestParkingDecision("car-test", "parking-car-test-3500");

    const car = useSimulationStore.getState().cars[0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(car.modelVersion).toBe("frontend-fallback");
    expect(car.state).toBe("parking");
    expect(car.decisionRequested).toBe(false);
    expect(car.parkingDecisionRequestId).toBeUndefined();
  });

  it("ignores stale in-flight decision ids before calling the backend", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("should not be called")));
    vi.stubGlobal("fetch", fetchMock);
    useSimulationStore.setState({
      elapsedSeconds: 3.5,
      selectedCarId: "car-test",
      paused: false,
      scenario,
      cars: [
        carAt("n7", {
          state: "choosing_parking",
          path: ["n7"],
          decisionRequested: true,
          parkingDecisionRequestId: "parking-car-test-current",
        }),
      ],
    });

    await useSimulationStore.getState().requestParkingDecision("car-test", "parking-car-test-stale");

    const car = useSimulationStore.getState().cars[0];
    expect(fetchMock).not.toHaveBeenCalled();
    expect(car.state).toBe("choosing_parking");
    expect(car.parkingDecisionRequestId).toBe("parking-car-test-current");
  });
});
