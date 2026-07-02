import { beforeEach, describe, expect, it } from "vitest";

import { city } from "../sim/city";
import type { CarAgent } from "../types";
import { useSimulationStore } from "./simulationStore";

const carById = (id: string) => useSimulationStore.getState().cars.find((car) => car.id === id)!;
const nodePosition = (id: string) => city.nodes.find((node) => node.id === id)!.position;

describe("simulation traffic-control waits", () => {
  beforeEach(() => {
    useSimulationStore.getState().reset();
  });

  it("sets an inspectable wait reason at the boundary before entering a stop-controlled node", () => {
    useSimulationStore.getState().setScenario("trafficDensity", 0);
    useSimulationStore.getState().tick(4);

    const car = carById("car-1");
    expect(car.currentNodeId).toBe("n1");
    expect(car.waitingForControlNodeId).toBe("n2");
    expect(car.waitReason).toBe("Stop sign at n2");
    expect(car.waitSeconds).toBeGreaterThan(0);
  });

  it("clears the wait after the control duration elapses", () => {
    useSimulationStore.getState().setScenario("trafficDensity", 0);
    useSimulationStore.getState().tick(4);
    const waitSeconds = carById("car-1").waitSeconds ?? 0;

    useSimulationStore.getState().tick(waitSeconds + 0.1);

    const car = carById("car-1");
    expect(car.waitReason).toBeUndefined();
    expect(car.waitingForControlNodeId).toBeUndefined();
    expect(car.clearedControlNodeId).toBe("n2");
  });

  it("keeps moving through a mid-edge red flip and waits at the arrival boundary", () => {
    useSimulationStore.getState().setScenario("trafficDensity", 0);
    useSimulationStore.setState({ elapsedSeconds: 6.5, cars: [lightApproachCar()] });

    useSimulationStore.getState().tick(0.6);

    let car = carById("light-car");
    expect(useSimulationStore.getState().elapsedSeconds).toBeCloseTo(7.1);
    expect(car.currentNodeId).toBe("n3");
    expect(car.position.x).toBeGreaterThan(nodePosition("n3").x);
    expect(car.position.x).toBeLessThan(nodePosition("n4").x);
    expect(car.waitReason).toBeUndefined();
    expect(car.waitingForControlNodeId).toBeUndefined();

    useSimulationStore.getState().tick(4);

    car = carById("light-car");
    expect(car.position.x).toBeCloseTo(70);
    expect(car.waitReason).toBeUndefined();

    useSimulationStore.getState().tick(0.21);

    car = carById("light-car");
    expect(car.currentNodeId).toBe("n3");
    expect(car.pathIndex).toBe(0);
    expect(car.position.x).toBeLessThan(nodePosition("n4").x);
    expect(car.waitingForControlNodeId).toBe("n4");
    expect(car.waitReason).toBe("Red light at n4");
    expect(car.waitSeconds).toBeGreaterThan(0);

    useSimulationStore.getState().tick((car.waitSeconds ?? 0) + 0.01);

    car = carById("light-car");
    expect(car.waitReason).toBeUndefined();
    expect(car.waitingForControlNodeId).toBeUndefined();
    expect(car.clearedControlNodeId).toBeUndefined();

    useSimulationStore.getState().tick(0.21);

    car = carById("light-car");
    expect(car.currentNodeId).toBe("n4");
    expect(car.pathIndex).toBe(1);
  });
});

function lightApproachCar(): CarAgent {
  return {
    id: "light-car",
    color: "#f97316",
    position: { ...nodePosition("n3") },
    currentNodeId: "n3",
    destinationId: "station",
    path: ["n3", "n4"],
    pathIndex: 0,
    state: "driving",
    speed: 10,
  };
}
