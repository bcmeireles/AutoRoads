import { describe, expect, it } from "vitest";

import { city } from "./city";
import { findRoute } from "./routing";

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
});
