import { describe, expect, it } from "vitest";

import { city } from "./city";
import { estimateRouteSeconds, findNearestNode, findRoute, outgoingEdges } from "./routing";

describe("findRoute", () => {
  it("finds a directed route across the city", () => {
    const route = findRoute(city, "n1", "n7");
    expect(route[0]).toBe("n1");
    expect(route.at(-1)).toBe("n7");
    expect(route.length).toBeGreaterThan(1);
  });

  it("honors one-way streets", () => {
    expect(findRoute(city, "n4", "n3")).not.toEqual(["n4", "n3"]);
  });

  it("returns an empty path when a node is missing", () => {
    expect(findRoute(city, "n1", "missing")).toEqual([]);
  });

  it("returns the current node for same-node routes", () => {
    expect(findRoute(city, "n7", "n7")).toEqual(["n7"]);
  });

  it("exposes reverse edges only for two-way roads", () => {
    expect(outgoingEdges(city, "n2").some((edge) => edge.id === "e1-reverse")).toBe(true);
    expect(outgoingEdges(city, "n4").some((edge) => edge.id === "e3-reverse")).toBe(false);
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
});
