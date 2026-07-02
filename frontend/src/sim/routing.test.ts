import { describe, expect, it } from "vitest";

import type { CityMap } from "../types";
import { city } from "./city";
import {
  estimateRouteSeconds,
  findDetailedRoute,
  findNearestNode,
  findRoute,
  outgoingEdges,
  routeDebugSummary,
  validateCityGraph,
} from "./routing";

const emptyCityParts = {
  buildings: [],
  destinations: [],
  parkingSpots: [],
};

const directedTestCity = {
  ...emptyCityParts,
  nodes: [
    { id: "a", position: { x: 0, z: 0 } },
    { id: "b", position: { x: 10, z: 0 } },
    { id: "c", position: { x: 0, z: 20 } },
    { id: "d", position: { x: 40, z: 40 } },
  ],
  edges: [
    { id: "slow-short", from: "a", to: "b", speedLimit: 1, oneWay: true },
    { id: "fast-leg-1", from: "a", to: "c", speedLimit: 30, oneWay: true },
    { id: "fast-leg-2", from: "c", to: "b", speedLimit: 30, oneWay: true },
    { id: "two-way", from: "b", to: "d", speedLimit: 10 },
  ],
} satisfies CityMap;

describe("findRoute", () => {
  it("finds a directed route across the city", () => {
    const route = findRoute(city, "n1", "n7");
    expect(route[0]).toBe("n1");
    expect(route.at(-1)).toBe("n7");
    expect(route.length).toBeGreaterThan(1);
  });

  it("honors one-way streets", () => {
    const result = findDetailedRoute(directedTestCity, "b", "a");

    expect(result.blockedReason).toBe("no_path");
    expect(result.nodeIds).toEqual([]);
  });

  it("returns an empty path when a node is missing", () => {
    expect(findRoute(city, "n1", "missing")).toEqual([]);
    expect(findDetailedRoute(city, "n1", "missing").blockedReason).toBe("unknown_destination");
    expect(findDetailedRoute(city, "missing", "n1").blockedReason).toBe("unknown_start");
  });

  it("returns the current node for same-node routes", () => {
    expect(findRoute(city, "n7", "n7")).toEqual(["n7"]);
  });

  it("exposes reverse edges only for two-way roads", () => {
    expect(outgoingEdges(city, "n2").some((edge) => edge.id === "e1-reverse")).toBe(true);
    expect(outgoingEdges(city, "n4").some((edge) => edge.id === "e3-reverse")).toBe(false);
  });

  it("allows reverse traversal on bidirectional edges", () => {
    const result = findDetailedRoute(directedTestCity, "d", "b");

    expect(result.nodeIds).toEqual(["d", "b"]);
    expect(result.edgeIds).toEqual(["two-way-reverse"]);
  });

  it("chooses the fastest path instead of the shortest geometric path", () => {
    const result = findDetailedRoute(directedTestCity, "a", "b");

    expect(result.nodeIds).toEqual(["a", "c", "b"]);
    expect(result.edgeIds).toEqual(["fast-leg-1", "fast-leg-2"]);
    expect(result.etaSeconds).toBeLessThan(2);
  });

  it("reports a useful blocked reason for disconnected subgraphs", () => {
    const result = findDetailedRoute(directedTestCity, "d", "a");

    expect(result.blockedReason).toBe("no_path");
    expect(routeDebugSummary(result)).toContain("no directed path");
  });

  it("summarizes successful detailed routes for debugging", () => {
    const result = findDetailedRoute(directedTestCity, "a", "b");

    expect(result.blockedReason).toBeUndefined();
    expect(routeDebugSummary(result)).toContain("Route ready");
    expect(routeDebugSummary(result)).toContain("2 edges");
  });

  it("increases ETA as traffic density rises", () => {
    const path = findRoute(city, "n1", "n7");
    const lightTrafficEta = estimateRouteSeconds(city, path, 0.1);
    const heavyTrafficEta = estimateRouteSeconds(city, path, 0.9);

    expect(heavyTrafficEta).toBeGreaterThan(lightTrafficEta);
  });

  it("finds the nearest graph node to a point", () => {
    expect(findNearestNode(city, { x: -70, z: -50 })).toBe("n1");
  });

  it("validates the curated city graph", () => {
    expect(() => validateCityGraph(city)).not.toThrow();
  });

  it("validates graph references and duplicate IDs", () => {
    const invalidCity = {
      ...emptyCityParts,
      nodes: [
        { id: "a", position: { x: 0, z: 0 } },
        { id: "a", position: { x: 1, z: 1 } },
      ],
      edges: [
        { id: "bad", from: "a", to: "missing", speedLimit: 0 },
        { id: "bad", from: "missing", to: "a", speedLimit: 5 },
      ],
      destinations: [
        {
          id: "dest",
          name: "Missing destination",
          nodeId: "missing",
          position: { x: 0, z: 0 },
          demand: 0.5,
        },
      ],
      parkingSpots: [
        {
          id: "parking",
          nodeId: "missing",
          position: { x: 0, z: 0 },
          price: 0,
          baseAvailability: 1,
          occupancyRisk: 0,
          legal: true,
          accessible: true,
        },
      ],
    } satisfies CityMap;

    expect(() => validateCityGraph(invalidCity)).toThrow(/Duplicate node id/);
    expect(() => validateCityGraph(invalidCity)).toThrow(/missing to node/);
    expect(() => validateCityGraph(invalidCity)).toThrow(/positive speed limit/);
    expect(() => validateCityGraph(invalidCity)).toThrow(/Destination/);
    expect(() => validateCityGraph(invalidCity)).toThrow(/Parking spot/);
  });
});
