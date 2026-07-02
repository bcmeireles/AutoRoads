import { beforeEach, describe, expect, it } from "vitest";

import { useSimulationStore } from "./simulationStore";

const carById = (id: string) => useSimulationStore.getState().cars.find((car) => car.id === id)!;

describe("simulation traffic-control waits", () => {
  beforeEach(() => {
    useSimulationStore.getState().reset();
  });

  it("sets an inspectable wait reason before entering a stop-controlled node", () => {
    useSimulationStore.getState().tick(0.1);

    const car = carById("car-1");
    expect(car.currentNodeId).toBe("n1");
    expect(car.waitingForControlNodeId).toBe("n2");
    expect(car.waitReason).toBe("Stop sign at n2");
    expect(car.waitSeconds).toBeGreaterThan(0);
  });

  it("clears the wait after the control duration elapses", () => {
    useSimulationStore.getState().tick(0.1);
    const waitSeconds = carById("car-1").waitSeconds ?? 0;

    useSimulationStore.getState().tick(waitSeconds + 0.1);

    const car = carById("car-1");
    expect(car.waitReason).toBeUndefined();
    expect(car.waitingForControlNodeId).toBeUndefined();
    expect(car.clearedControlNodeId).toBe("n2");
  });
});
