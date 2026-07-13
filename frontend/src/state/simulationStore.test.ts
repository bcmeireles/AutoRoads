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

  it("waits in place, enters once, and stops again on a later visit", () => {
    useSimulationStore.getState().setScenario("trafficDensity", 0);
    useSimulationStore.setState({ cars: [stopLoopCar()] });
    const stoppedPosition = { ...nodePosition("n1") };

    useSimulationStore.getState().tick(1);
    let car = carById("stop-loop-car");
    expect(car.position).toEqual(stoppedPosition);
    expect(car.currentNodeId).toBe("n1");
    expect(car.pathIndex).toBe(0);
    expect(car.waitSeconds).toBe(0.9);

    useSimulationStore.getState().tick(0.89);
    car = carById("stop-loop-car");
    expect(car.position).toEqual(stoppedPosition);
    expect(car.pathIndex).toBe(0);
    expect(car.waitSeconds).toBeCloseTo(0.01);
    expect(car.clearedControlNodeId).toBeUndefined();

    useSimulationStore.getState().tick(0.01);
    car = carById("stop-loop-car");
    expect(car.position).toEqual(stoppedPosition);
    expect(car.waitReason).toBeUndefined();
    expect(car.waitingForControlNodeId).toBeUndefined();
    expect(car.clearedControlNodeId).toBe("n2");

    useSimulationStore.getState().tick(1);
    car = carById("stop-loop-car");
    expect(car.currentNodeId).toBe("n2");
    expect(car.pathIndex).toBe(1);
    expect(car.clearedControlNodeId).toBeUndefined();

    useSimulationStore.getState().tick(1);
    car = carById("stop-loop-car");
    expect(car.currentNodeId).toBe("n1");
    expect(car.pathIndex).toBe(2);

    useSimulationStore.getState().tick(1);
    car = carById("stop-loop-car");
    expect(car.position).toEqual(stoppedPosition);
    expect(car.currentNodeId).toBe("n1");
    expect(car.pathIndex).toBe(2);
    expect(car.waitingForControlNodeId).toBe("n2");
    expect(car.waitSeconds).toBe(0.9);
  });

  it("allows an arrival just before green changes to red", () => {
    useSimulationStore.getState().setScenario("trafficDensity", 0);
    useSimulationStore.setState({
      elapsedSeconds: 6.5,
      cars: [lightBoundaryCar("before-red")],
    });

    useSimulationStore.getState().tick(1);

    const car = carById("before-red");
    expect(useSimulationStore.getState().elapsedSeconds).toBe(7.5);
    expect(car.currentNodeId).toBe("n4");
    expect(car.pathIndex).toBe(1);
    expect(car.waitReason).toBeUndefined();
  });

  it("holds an arrival just before red changes to green", () => {
    useSimulationStore.getState().setScenario("trafficDensity", 0);
    useSimulationStore.setState({
      elapsedSeconds: 13.5,
      cars: [lightBoundaryCar("before-green")],
    });

    useSimulationStore.getState().tick(1);

    const car = carById("before-green");
    expect(useSimulationStore.getState().elapsedSeconds).toBe(14.5);
    expect(car.currentNodeId).toBe("n3");
    expect(car.pathIndex).toBe(0);
    expect(car.position.x).toBeCloseTo(67.01);
    expect(car.waitingForControlNodeId).toBe("n4");
    expect(car.waitReason).toBe("Red light at n4");
    expect(car.waitSeconds).toBeCloseTo(0.001);
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

function lightBoundaryCar(id: string): CarAgent {
  return {
    ...lightApproachCar(),
    id,
    position: { x: 67.01, z: nodePosition("n4").z },
  };
}

function stopLoopCar(): CarAgent {
  return {
    id: "stop-loop-car",
    color: "#3b82f6",
    position: { ...nodePosition("n1") },
    currentNodeId: "n1",
    destinationId: "market",
    path: ["n1", "n2", "n1", "n2"],
    pathIndex: 0,
    state: "driving",
    speed: 48,
  };
}
