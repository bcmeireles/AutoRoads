import { describe, expect, it } from "vitest";

import type { CarAgent, CityMap, Destination, ScenarioSettings } from "../types";
import { buildCandidates, localFallbackDecision } from "./parking";

const settings: ScenarioSettings = {
  trafficDensity: 0.2,
  parkingScarcity: 0.1,
  tripDemand: 0.4,
  driveTimeWeight: 0.35,
  walkDistanceWeight: 0.25,
  priceWeight: 0.15,
  availabilityRiskWeight: 0.15,
  congestionWeight: 0.1,
};

const destination: Destination = {
  id: "dest",
  name: "Office",
  nodeId: "reachable",
  position: { x: 10, z: 0 },
  demand: 0.5,
};

const car: CarAgent = {
  id: "car-1",
  color: "#2563eb",
  position: { x: 0, z: 0 },
  currentNodeId: "start",
  destinationId: destination.id,
  path: [],
  pathIndex: 0,
  state: "choosing_parking",
  speed: 9,
};

const city = {
  nodes: [
    { id: "start", position: { x: 0, z: 0 } },
    { id: "reachable", position: { x: 10, z: 0 } },
    { id: "isolated", position: { x: 0, z: 20 } },
  ],
  edges: [{ id: "start-to-reachable", from: "start", to: "reachable", speedLimit: 10, oneWay: true }],
  buildings: [],
  destinations: [destination],
  parkingSpots: [
    {
      id: "reachable-spot",
      nodeId: "reachable",
      position: { x: 10, z: 0 },
      price: 2,
      baseAvailability: 0.8,
      occupancyRisk: 0.2,
      legal: true,
      accessible: true,
    },
    {
      id: "unreachable-spot",
      nodeId: "isolated",
      position: { x: 0, z: 20 },
      price: 1,
      baseAvailability: 0.9,
      occupancyRisk: 0.1,
      legal: true,
      accessible: true,
    },
  ],
} satisfies CityMap;

describe("parking candidates", () => {
  it("marks no-path spots ineligible for backend and local fallback selection", () => {
    const candidates = buildCandidates(city, car, destination, settings);
    const reachable = candidates.find((candidate) => candidate.id === "reachable-spot");
    const unreachable = candidates.find((candidate) => candidate.id === "unreachable-spot");

    expect(reachable).toMatchObject({
      accessible: true,
      availability: expect.any(Number),
      drive_eta_seconds: expect.any(Number),
    });
    expect(unreachable).toMatchObject({
      accessible: false,
      availability: 0,
      drive_eta_seconds: 999,
      legal: true,
    });
    expect(localFallbackDecision(city, car, destination, settings).selected_spot_id).toBe(
      "reachable-spot",
    );
  });
});
