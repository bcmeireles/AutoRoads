import { describe, expect, it } from "vitest";

import type { CarAgent, RoadNode } from "../types";
import { controlStateAt, requiredWaitSeconds } from "./trafficControls";

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
});

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
