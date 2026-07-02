import { describe, expect, it } from "vitest";

import type { CandidateScore, CarAgent, ParkingSpot, RoadNode } from "../types";
import { sceneRoutePoints, shouldShowPendingCandidateCues } from "./citySceneHelpers";

const baseCar: CarAgent = {
  id: "car-1",
  color: "#000000",
  position: { x: 0, z: 0 },
  currentNodeId: "n1",
  destinationId: "dest",
  path: ["n1", "n2"],
  pathIndex: 0,
  state: "driving",
  speed: 10,
};

const nodes: RoadNode[] = [
  { id: "n1", position: { x: 0, z: 0 } },
  { id: "n2", position: { x: 10, z: 0 } },
];

const parkingSpots: ParkingSpot[] = [
  {
    id: "p1",
    nodeId: "n2",
    position: { x: 12, z: -4 },
    price: 2,
    baseAvailability: 0.8,
    occupancyRisk: 0.2,
    legal: true,
    accessible: true,
  },
  {
    id: "p2",
    nodeId: "n2",
    position: { x: 10.05, z: 0.02 },
    price: 3,
    baseAvailability: 0.7,
    occupancyRisk: 0.3,
    legal: true,
    accessible: true,
  },
];

describe("city scene helpers", () => {
  it("shows pending candidate cues only while a parking decision is actually pending", () => {
    const score: CandidateScore = { spot_id: "p1", score: 1, eligible: true, rank: 1 };

    expect(shouldShowPendingCandidateCues(undefined)).toBe(false);
    expect(shouldShowPendingCandidateCues(baseCar)).toBe(false);
    expect(
      shouldShowPendingCandidateCues({
        ...baseCar,
        state: "choosing_parking",
        decisionRequested: true,
      }),
    ).toBe(true);
    expect(
      shouldShowPendingCandidateCues({
        ...baseCar,
        state: "choosing_parking",
        decisionRequested: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPendingCandidateCues({
        ...baseCar,
        state: "choosing_parking",
        decisionRequested: true,
        candidateScores: [score],
      }),
    ).toBe(false);
  });

  it("extends selected parking routes from the graph node to the offset spot position", () => {
    const points = sceneRoutePoints(
      { ...baseCar, chosenSpotId: "p1" },
      nodes,
      parkingSpots,
    );

    expect(points).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 12, z: -4 },
    ]);
  });

  it("does not duplicate the final route point when the chosen spot already matches it", () => {
    const points = sceneRoutePoints(
      { ...baseCar, chosenSpotId: "p2" },
      nodes,
      parkingSpots,
    );

    expect(points).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]);
  });
});
