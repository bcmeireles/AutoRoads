import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  decideParking,
  localFallbackDecision,
  type ParkingDecision,
} from "../api/parking";
import { city } from "../sim/city";
import {
  routeEtaSeconds,
  selectedCar,
  useSimulationStore,
} from "./simulationStore";

vi.mock("../api/parking", () => ({
  decideParking: vi.fn(),
  localFallbackDecision: vi.fn(),
}));

const decideParkingMock = vi.mocked(decideParking);
const localFallbackDecisionMock = vi.mocked(localFallbackDecision);

function parkingDecision(): ParkingDecision {
  const selectedSpot = city.parkingSpots[0];
  const nearestSpot = city.parkingSpots[1];
  const randomSpot = city.parkingSpots[2];

  return {
    selected_spot_id: selectedSpot.id,
    candidate_scores: [
      { spot_id: selectedSpot.id, score: 91, eligible: true, rank: 1 },
    ],
    baselines: [
      { strategy: "nearest", spot_id: nearestSpot.id, score: 82 },
      { strategy: "random", spot_id: randomSpot.id, score: 61 },
    ],
    explanation: [
      { feature: "drive_time", impact: 1.2, direction: "helps", detail: "Fast route" },
    ],
    model_version: "test-model-v1",
  };
}

describe("simulation store dashboard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSimulationStore.setState(useSimulationStore.getInitialState(), true);
    useSimulationStore.getState().reset();
  });

  it("updates one scenario setting without replacing the others", () => {
    const initialScenario = useSimulationStore.getState().scenario;

    useSimulationStore.getState().setScenario("trafficDensity", 0.73);

    const scenario = useSimulationStore.getState().scenario;
    expect(scenario.trafficDensity).toBe(0.73);
    expect(scenario.parkingScarcity).toBe(initialScenario.parkingScarcity);
    expect(scenario.tripDemand).toBe(initialScenario.tripDemand);
  });

  it("pauses and resumes simulation ticks", () => {
    const store = useSimulationStore.getState();

    store.togglePaused();
    useSimulationStore.getState().tick(2);
    expect(useSimulationStore.getState().elapsedSeconds).toBe(0);

    useSimulationStore.getState().togglePaused();
    useSimulationStore.getState().tick(2);
    expect(useSimulationStore.getState().elapsedSeconds).toBe(2);
  });

  it("resets controls, scenario, selection, and both parking baselines", () => {
    const defaultScenario = useSimulationStore.getState().scenario;
    useSimulationStore.setState((state) => ({
      elapsedSeconds: 18,
      selectedCarId: "car-2",
      paused: true,
      scenario: { ...state.scenario, trafficDensity: 0.99 },
      cars: state.cars.map((car, index) =>
        index === 0
          ? {
              ...car,
              chosenSpotId: city.parkingSpots[0].id,
              baselineSpotId: city.parkingSpots[1].id,
              randomBaselineSpotId: city.parkingSpots[2].id,
            }
          : car,
      ),
    }));

    useSimulationStore.getState().reset();

    const resetState = useSimulationStore.getState();
    expect(resetState.elapsedSeconds).toBe(0);
    expect(resetState.selectedCarId).toBe("car-1");
    expect(resetState.paused).toBe(false);
    expect(resetState.scenario).toEqual(defaultScenario);
    expect(resetState.cars[0]).toMatchObject({
      chosenSpotId: undefined,
      baselineSpotId: undefined,
      randomBaselineSpotId: undefined,
    });
  });

  it("selects a car and falls back to the first car for an unknown selection", () => {
    useSimulationStore.getState().selectCar("car-2");
    expect(selectedCar(useSimulationStore.getState()).id).toBe("car-2");

    useSimulationStore.getState().selectCar("missing-car");
    expect(selectedCar(useSimulationStore.getState()).id).toBe("car-1");
  });

  it("derives route ETA from the selected route and traffic level", () => {
    const state = useSimulationStore.getState();
    const car = selectedCar(state);
    const clearTrafficEta = routeEtaSeconds(car, { ...state.scenario, trafficDensity: 0 });
    const heavyTrafficEta = routeEtaSeconds(car, { ...state.scenario, trafficDensity: 1 });

    expect(clearTrafficEta).toBeGreaterThan(0);
    expect(heavyTrafficEta).toBeGreaterThan(clearTrafficEta);
  });

  it("propagates nearest and random baselines from a parking decision", async () => {
    const decision = parkingDecision();
    decideParkingMock.mockResolvedValue(decision);

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars.find((candidate) => candidate.id === "car-1");
    expect(car).toMatchObject({
      chosenSpotId: decision.selected_spot_id,
      baselineSpotId: decision.baselines[0].spot_id,
      randomBaselineSpotId: decision.baselines[1].spot_id,
      modelVersion: decision.model_version,
      state: "parking",
    });
  });

  it("preserves both baselines when the backend falls back locally", async () => {
    const decision = parkingDecision();
    decideParkingMock.mockRejectedValue(new Error("offline"));
    localFallbackDecisionMock.mockReturnValue(decision);

    await useSimulationStore.getState().requestParkingDecision("car-1");

    const car = useSimulationStore.getState().cars.find((candidate) => candidate.id === "car-1");
    expect(localFallbackDecisionMock).toHaveBeenCalledOnce();
    expect(car?.baselineSpotId).toBe(decision.baselines[0].spot_id);
    expect(car?.randomBaselineSpotId).toBe(decision.baselines[1].spot_id);
  });
});
