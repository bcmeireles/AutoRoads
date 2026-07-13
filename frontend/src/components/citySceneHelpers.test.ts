import { describe, expect, it, vi } from "vitest";

import type { CandidateScore, CarAgent, ParkingSpot, RoadNode } from "../types";
import {
  cameraFitZoom,
  carHeading,
  carStateColor,
  clampCameraTarget,
  controlStateAt,
  handleCarMarkerClick,
  parkingMarkerAppearance,
  sceneRoutePoints,
  shouldShowPendingCandidateCues,
} from "./citySceneHelpers";
import type { SceneControlledNode } from "./citySceneHelpers";

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
  { id: "n3", position: { x: 20, z: 0 } },
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
  {
    id: "p3",
    nodeId: "n3",
    position: { x: 22, z: 4 },
    price: 1,
    baseAvailability: 0.9,
    occupancyRisk: 0.1,
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

  it("does not extend a blocked route to a chosen spot", () => {
    const points = sceneRoutePoints(
      { ...baseCar, chosenSpotId: "p1", state: "blocked" },
      nodes,
      parkingSpots,
    );

    expect(points).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]);
  });

  it("does not extend a route that ends at a different node than the chosen spot", () => {
    const points = sceneRoutePoints(
      { ...baseCar, chosenSpotId: "p3", state: "parking" },
      nodes,
      parkingSpots,
    );

    expect(points).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]);
  });

  it("matches legacy traffic-light movement semantics at phase boundaries", () => {
    const node: SceneControlledNode = {
      id: "signal",
      position: { x: 0, z: 0 },
      control: "traffic-light",
    };

    expect(controlStateAt(node, 0).signal).toBe("green");
    expect(controlStateAt(node, 6.999).signal).toBe("green");
    expect(controlStateAt(node, 7).signal).toBe("red");
    expect(controlStateAt(node, 13.999).signal).toBe("red");
    expect(controlStateAt(node, 14).signal).toBe("green");
  });

  it("accepts structured traffic controls with controlStateAt-compatible boundaries", () => {
    const node: SceneControlledNode = {
      id: "structured-signal",
      position: { x: 0, z: 0 },
      control: {
        kind: "traffic-light",
        programId: "short-cycle",
        phases: [
          { state: "green", durationSeconds: 3 },
          { state: "red", durationSeconds: 2 },
        ],
      },
    };

    expect(controlStateAt(node, 2.999)).toMatchObject({
      signal: "green",
      canEnter: true,
      phaseIndex: 0,
      programId: "short-cycle",
    });
    expect(controlStateAt(node, 3)).toMatchObject({
      signal: "red",
      canEnter: false,
      waitSeconds: 2,
      phaseIndex: 1,
    });
    expect(controlStateAt(node, 5).signal).toBe("green");
  });

  it("derives candidate, chosen, and baseline marker variants", () => {
    const candidateScore: CandidateScore = {
      spot_id: "p1",
      score: 0.8,
      eligible: false,
      rank: 2,
    };

    expect(
      parkingMarkerAppearance(parkingSpots[0], {
        candidateScore,
        isChosen: true,
        isNearestBaseline: true,
        showPendingCandidate: false,
      }),
    ).toMatchObject({
      baseColor: "#f8fafc",
      isCandidate: true,
      isEligibleCandidate: false,
      candidateRank: 2,
      showChosenCue: true,
      showNearestBaselineCue: true,
      showParkingLetter: true,
    });
  });

  it("distinguishes illegal and inaccessible parking marker cues", () => {
    const options = {
      isChosen: false,
      isNearestBaseline: false,
      showPendingCandidate: false,
    };

    expect(
      parkingMarkerAppearance({ legal: false, accessible: true }, options),
    ).toMatchObject({
      baseColor: "#fecaca",
      showIllegalCue: true,
      showInaccessibleCue: false,
      showParkingLetter: false,
    });
    expect(
      parkingMarkerAppearance({ legal: true, accessible: false }, options),
    ).toMatchObject({
      baseColor: "#cbd5e1",
      showIllegalCue: false,
      showInaccessibleCue: true,
      showParkingLetter: false,
    });
  });

  it("fits the camera within scene zoom limits and clamps pan targets", () => {
    expect(cameraFitZoom(214, 178)).toBe(1.65);
    expect(cameraFitZoom(1070, 890)).toBe(5);
    expect(cameraFitZoom(4000, 4000)).toBe(5.2);
    expect(
      clampCameraTarget(
        { x: 80, z: -60 },
        { minX: -62, maxX: 62, minZ: -42, maxZ: 42 },
      ),
    ).toEqual({ x: 62, z: -42 });
  });

  it("derives car marker heading and state colors", () => {
    expect(carHeading(baseCar, nodes)).toBeCloseTo(Math.PI / 2);
    expect(carStateColor({ state: "driving" })).toBe("#38bdf8");
    expect(carStateColor({ state: "choosing_parking" })).toBe("#f97316");
    expect(carStateColor({ state: "blocked" })).toBe("#dc2626");
  });

  it("stops scene propagation and selects a clicked car", () => {
    const stopPropagation = vi.fn();
    const onSelect = vi.fn();

    handleCarMarkerClick({ stopPropagation }, onSelect);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
