import type { CityMap, RoadEdge, Vec2 } from "../types";

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export type RouteBlockedReason =
  | "unknown_start"
  | "unknown_destination"
  | "no_path";

export type RouteResult = {
  nodeIds: string[];
  edgeIds: string[];
  etaSeconds: number;
  blockedReason?: RouteBlockedReason;
};

type TraversableEdge = RoadEdge & {
  length: number;
};

type RouteGraph = {
  nodesById: Map<string, Vec2>;
  adjacency: Map<string, TraversableEdge[]>;
  edgesById: Map<string, TraversableEdge>;
};

const routeGraphCache = new WeakMap<CityMap, RouteGraph>();

const traversalCost = (edge: TraversableEdge) => edge.length / edge.speedLimit;

export function validateCityGraph(city: CityMap): void {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of city.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}".`);
    }
    nodeIds.add(node.id);
  }

  for (const edge of city.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge id "${edge.id}".`);
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge "${edge.id}" references missing from node "${edge.from}".`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge "${edge.id}" references missing to node "${edge.to}".`);
    }
    if (!Number.isFinite(edge.speedLimit) || edge.speedLimit <= 0) {
      errors.push(`Edge "${edge.id}" must have a finite positive speed limit.`);
    }
  }

  for (const edge of city.edges) {
    if (!edge.oneWay && edgeIds.has(`${edge.id}-reverse`)) {
      errors.push(
        `Generated reverse traversal id "${edge.id}-reverse" for edge "${edge.id}" collides with an authored edge id.`,
      );
    }
  }

  for (const destination of city.destinations) {
    if (!nodeIds.has(destination.nodeId)) {
      errors.push(`Destination "${destination.id}" references missing node "${destination.nodeId}".`);
    }
  }

  for (const spot of city.parkingSpots) {
    if (!nodeIds.has(spot.nodeId)) {
      errors.push(`Parking spot "${spot.id}" references missing node "${spot.nodeId}".`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid city graph:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

export function findRoute(city: CityMap, fromNodeId: string, toNodeId: string): string[] {
  return findDetailedRoute(city, fromNodeId, toNodeId).nodeIds;
}

export function findDetailedRoute(
  city: CityMap,
  fromNodeId: string,
  toNodeId: string,
): RouteResult {
  const graph = routeGraphFor(city);

  if (!graph.nodesById.has(fromNodeId)) {
    return { nodeIds: [], edgeIds: [], etaSeconds: 0, blockedReason: "unknown_start" };
  }
  if (!graph.nodesById.has(toNodeId)) {
    return { nodeIds: [], edgeIds: [], etaSeconds: 0, blockedReason: "unknown_destination" };
  }
  if (fromNodeId === toNodeId) {
    return { nodeIds: [fromNodeId], edgeIds: [], etaSeconds: 0 };
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const unvisited = new Set(graph.nodesById.keys());
  for (const nodeId of graph.nodesById.keys()) distances.set(nodeId, Number.POSITIVE_INFINITY);
  distances.set(fromNodeId, 0);

  while (unvisited.size > 0) {
    const current = [...unvisited].sort(
      (a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity),
    )[0];
    if (!current || (distances.get(current) ?? Infinity) === Infinity) break;
    if (current === toNodeId) break;
    unvisited.delete(current);

    for (const edge of graph.adjacency.get(current) ?? []) {
      if (!unvisited.has(edge.to)) continue;
      const cost = traversalCost(edge);
      const candidateDistance = (distances.get(current) ?? Infinity) + cost;
      if (candidateDistance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, candidateDistance);
        previous.set(edge.to, { nodeId: current, edgeId: edge.id });
      }
    }
  }

  if (!previous.has(toNodeId)) {
    return { nodeIds: [], edgeIds: [], etaSeconds: 0, blockedReason: "no_path" };
  }

  const path = [toNodeId];
  const edgeIds: string[] = [];
  let current = toNodeId;
  while (current !== fromNodeId) {
    const step = previous.get(current)!;
    edgeIds.unshift(step.edgeId);
    current = step.nodeId;
    path.unshift(current);
  }
  return { nodeIds: path, edgeIds, etaSeconds: distances.get(toNodeId) ?? 0 };
}

export function outgoingEdges(city: CityMap, nodeId: string): RoadEdge[] {
  return (routeGraphFor(city).adjacency.get(nodeId) ?? []).map(({ length, ...edge }) => ({
    ...edge,
  }));
}

export function estimateRouteSeconds(
  city: CityMap,
  route: string[] | Pick<RouteResult, "edgeIds" | "nodeIds">,
  trafficDensity: number,
): number {
  if (!Array.isArray(route)) {
    return estimateEdgeIdsSeconds(city, route.edgeIds, trafficDensity);
  }

  const path = route;
  if (path.length < 2) return 0;
  const graph = routeGraphFor(city);
  let seconds = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const edge = minimumCostEdge(graph.adjacency.get(path[index]) ?? [], path[index + 1]);
    if (!edge) continue;
    seconds += traversalCost(edge) * (1 + trafficDensity * 0.65);
  }
  return seconds;
}

function minimumCostEdge(edges: TraversableEdge[], toNodeId: string): TraversableEdge | undefined {
  let best: TraversableEdge | undefined;
  for (const edge of edges) {
    if (edge.to === toNodeId && (!best || traversalCost(edge) < traversalCost(best))) {
      best = edge;
    }
  }
  return best;
}

function estimateEdgeIdsSeconds(
  city: CityMap,
  edgeIds: string[],
  trafficDensity: number,
): number {
  if (edgeIds.length === 0) return 0;
  const graph = routeGraphFor(city);
  let seconds = 0;
  for (const edgeId of edgeIds) {
    const edge = graph.edgesById.get(edgeId);
    if (!edge) continue;
    seconds += traversalCost(edge) * (1 + trafficDensity * 0.65);
  }
  return seconds;
}

export function findNearestNode(city: CityMap, point: Vec2): string {
  if (city.nodes.length === 0) {
    throw new Error("Cannot find nearest node in an empty city graph.");
  }
  return [...city.nodes].sort(
    (a, b) => distance(a.position, point) - distance(b.position, point),
  )[0].id;
}

export function distanceMeters(a: Vec2, b: Vec2): number {
  return distance(a, b) * 7.5;
}

export function routeDebugSummary(result: RouteResult): string {
  if (result.blockedReason === "unknown_start") return "Route blocked: unknown start node.";
  if (result.blockedReason === "unknown_destination") {
    return "Route blocked: unknown destination node.";
  }
  if (result.blockedReason === "no_path") return "Route blocked: no directed path exists.";
  const etaSeconds = result.etaSeconds.toFixed(1);
  return `Route ready: ${result.nodeIds.length} nodes, ${result.edgeIds.length} edges, ${etaSeconds}s ETA.`;
}

function routeGraphFor(city: CityMap): RouteGraph {
  const cached = routeGraphCache.get(city);
  if (cached) return cached;

  validateCityGraph(city);
  const nodesById = new Map(city.nodes.map((node) => [node.id, node.position]));
  const adjacency = new Map<string, TraversableEdge[]>();
  const edgesById = new Map<string, TraversableEdge>();
  for (const nodeId of nodesById.keys()) adjacency.set(nodeId, []);

  const addTraversableEdge = (edge: TraversableEdge) => {
    adjacency.get(edge.from)!.push(edge);
    edgesById.set(edge.id, edge);
  };

  for (const edge of city.edges) {
    const from = nodesById.get(edge.from)!;
    const to = nodesById.get(edge.to)!;
    const length = distance(from, to);
    addTraversableEdge({ ...edge, length });
    if (!edge.oneWay) {
      addTraversableEdge({
        ...edge,
        id: `${edge.id}-reverse`,
        from: edge.to,
        to: edge.from,
        length,
      });
    }
  }

  const graph = { nodesById, adjacency, edgesById };
  routeGraphCache.set(city, graph);
  return graph;
}
