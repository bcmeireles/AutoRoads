import { describe, expect, it } from "vitest";

import type { CarAgent, RoadNode } from "../types";
import {
  advanceTrafficControlWait,
  completeTrafficControlEntry,
  controlStateAt,
  requiredWaitSeconds,
  resolveTrafficControlArrival,
} from "./trafficControls";

const car = {
  id: "car-1",
  currentNodeId: "before-light",
} satisfies Pick<CarAgent, "id" | "currentNodeId">;

describe("traffic controls", () => {
  it("requires a deterministic stop sign wait", () => {
    const node: RoadNode = {
      id: "stop-node",
      position: { x: 0, z: 0 },
      control: { kind: "stop", stopDurationSeconds: 1.2 },
    };

    expect(requiredWaitSeconds(car, node, 0)).toBe(1.2);
    expect(requiredWaitSeconds(car, node, 50)).toBe(1.2);
    expect(controlStateAt(node, 10).reason).toContain("Stop sign");
  });

  it("blocks red traffic-light phases and reports remaining wait", () => {
    const node = lightNode();

    const state = controlStateAt(node, 8, car.currentNodeId);

    expect(state.signal).toBe("red");
    expect(state.canEnter).toBe(false);
    expect(state.waitSeconds).toBe(6);
    expect(requiredWaitSeconds(car, node, 8)).toBe(6);
  });

  it("allows green traffic-light phases", () => {
    const state = controlStateAt(lightNode(), 2, car.currentNodeId);

    expect(state.signal).toBe("green");
    expect(state.canEnter).toBe(true);
    expect(requiredWaitSeconds(car, lightNode(), 2)).toBe(0);
  });

  it("is deterministic at phase boundaries", () => {
    const node = lightNode();

    expect(controlStateAt(node, 6.999, car.currentNodeId).signal).toBe("green");
    expect(controlStateAt(node, 7, car.currentNodeId).signal).toBe("red");
    expect(controlStateAt(node, 14, car.currentNodeId).signal).toBe("green");
  });

  it("lets unaffected approaches enter during a scoped red phase", () => {
    const node: RoadNode = {
      id: "scoped-light",
      position: { x: 0, z: 0 },
      control: {
        kind: "traffic-light",
        programId: "scoped",
        phases: [
          { state: "red", durationSeconds: 5, appliesToNodeIds: ["blocked-approach"] },
          { state: "green", durationSeconds: 5 },
        ],
      },
    };

    expect(controlStateAt(node, 2, "blocked-approach").canEnter).toBe(false);
    expect(controlStateAt(node, 2, "open-approach").canEnter).toBe(true);
  });

  it("evaluates signals at the actual arrival time before each phase transition", () => {
    const beforeRed = resolveTrafficControlArrival({
      car: agentCar(),
      nextNode: lightNode(),
      tickStartedAtSeconds: 6.5,
      distanceToNode: 4.99,
      speedPerSecond: 10,
    });
    const beforeGreen = resolveTrafficControlArrival({
      car: agentCar(),
      nextNode: lightNode(),
      tickStartedAtSeconds: 13.5,
      distanceToNode: 4.99,
      speedPerSecond: 10,
    });

    expect(beforeRed.arrivalSeconds).toBeCloseTo(6.999);
    expect(beforeRed.canEnter).toBe(true);
    expect(beforeGreen.arrivalSeconds).toBeCloseTo(13.999);
    expect(beforeGreen.canEnter).toBe(false);
    expect(beforeGreen.agent.waitSeconds).toBeCloseTo(0.001);
  });

  it("grants one stop entry after waiting and requires another wait on revisit", () => {
    const node: RoadNode = {
      id: "stop-node",
      position: { x: 0, z: 0 },
      control: { kind: "stop", stopDurationSeconds: 0.9 },
    };
    const firstArrival = resolveTrafficControlArrival({
      car: agentCar(),
      nextNode: node,
      tickStartedAtSeconds: 0,
      distanceToNode: 1,
      speedPerSecond: 10,
    });

    expect(firstArrival.canEnter).toBe(false);
    const stillWaiting = advanceTrafficControlWait(firstArrival.agent, 0.89, node);
    expect(stillWaiting.waitSeconds).toBeCloseTo(0.01);
    expect(stillWaiting.clearedControlNodeId).toBeUndefined();

    const cleared = advanceTrafficControlWait(stillWaiting, 0.01, node);
    expect(cleared.waitSeconds).toBe(0);
    expect(cleared.clearedControlNodeId).toBe(node.id);

    const permittedEntry = resolveTrafficControlArrival({
      car: cleared,
      nextNode: node,
      tickStartedAtSeconds: 1,
      distanceToNode: 0,
      speedPerSecond: 10,
    });
    expect(permittedEntry.canEnter).toBe(true);

    const afterEntry = completeTrafficControlEntry(permittedEntry.agent);
    const repeatArrival = resolveTrafficControlArrival({
      car: { ...afterEntry, currentNodeId: "other-node" },
      nextNode: node,
      tickStartedAtSeconds: 2,
      distanceToNode: 0,
      speedPerSecond: 10,
    });
    expect(afterEntry.clearedControlNodeId).toBeUndefined();
    expect(repeatArrival.canEnter).toBe(false);
    expect(repeatArrival.agent.waitSeconds).toBe(0.9);
  });
});

function agentCar(): CarAgent {
  return {
    id: "agent-car",
    color: "#ffffff",
    position: { x: 0, z: 0 },
    currentNodeId: "before-light",
    destinationId: "station",
    path: ["before-light", "light-node"],
    pathIndex: 0,
    state: "driving",
    speed: 10,
  };
}

function lightNode(): RoadNode {
  return {
    id: "light-node",
    position: { x: 0, z: 0 },
    control: {
      kind: "traffic-light",
      programId: "test-light",
      phases: [
        { state: "green", durationSeconds: 7 },
        { state: "red", durationSeconds: 7 },
      ],
    },
  };
}
