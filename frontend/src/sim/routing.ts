import type { CityMap, RoadEdge, Vec2 } from "../types";

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export function findRoute(city: CityMap, fromNodeId: string, toNodeId: string): string[] {
  if (fromNodeId === toNodeId) return [fromNodeId];

  const nodeIds = new Set(city.nodes.map((node) => node.id));
  if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return [];

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const unvisited = new Set(nodeIds);
  for (const nodeId of nodeIds) distances.set(nodeId, Number.POSITIVE_INFINITY);
  distances.set(fromNodeId, 0);

  while (unvisited.size > 0) {
    const current = [...unvisited].sort(
      (a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity),
    )[0];
    if (!current || current === toNodeId) break;
    unvisited.delete(current);

    for (const edge of outgoingEdges(city, current)) {
      if (!unvisited.has(edge.to)) continue;
      const from = city.nodes.find((node) => node.id === edge.from)!;
      const to = city.nodes.find((node) => node.id === edge.to)!;
      const cost = distance(from.position, to.position) / edge.speedLimit;
      const candidateDistance = (distances.get(current) ?? Infinity) + cost;
      if (candidateDistance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, candidateDistance);
        previous.set(edge.to, current);
      }
    }
  }

  if (!previous.has(toNodeId)) return [];
  const path = [toNodeId];
  let current = toNodeId;
  while (current !== fromNodeId) {
    current = previous.get(current)!;
    path.unshift(current);
  }
  return path;
}

export function outgoingEdges(city: CityMap, nodeId: string): RoadEdge[] {
  const forward = city.edges.filter((edge) => edge.from === nodeId);
  const reverse = city.edges
    .filter((edge) => edge.to === nodeId && !edge.oneWay)
    .map((edge) => ({ ...edge, id: `${edge.id}-reverse`, from: edge.to, to: edge.from }));
  return [...forward, ...reverse];
}

export function estimateRouteSeconds(city: CityMap, path: string[], trafficDensity: number): number {
  if (path.length < 2) return 0;
  let seconds = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = city.nodes.find((node) => node.id === path[index]);
    const to = city.nodes.find((node) => node.id === path[index + 1]);
    if (!from || !to) continue;
    seconds += (distance(from.position, to.position) / 9) * (1 + trafficDensity * 0.65);
  }
  return seconds;
}

export function findNearestNode(city: CityMap, point: Vec2): string {
  return [...city.nodes].sort(
    (a, b) => distance(a.position, point) - distance(b.position, point),
  )[0].id;
}

export function distanceMeters(a: Vec2, b: Vec2): number {
  return distance(a, b) * 7.5;
}

