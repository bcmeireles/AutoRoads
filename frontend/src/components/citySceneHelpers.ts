import type { CarAgent, ParkingSpot, RoadNode, Vec2 } from "../types";

type RouteCar = Pick<CarAgent, "chosenSpotId" | "path" | "pathIndex" | "position">;
type CandidateCueCar = Pick<CarAgent, "candidateScores" | "decisionRequested" | "state">;

export function shouldShowPendingCandidateCues(car: CandidateCueCar | undefined): boolean {
  return Boolean(
    car &&
      car.state === "choosing_parking" &&
      car.decisionRequested === true &&
      !car.candidateScores,
  );
}

export function sceneRoutePoints(
  car: RouteCar,
  nodes: Pick<RoadNode, "id" | "position">[],
  parkingSpots: Pick<ParkingSpot, "id" | "position">[],
): Vec2[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node.position]));
  const nextNodeIds = car.path.slice(Math.min(car.pathIndex + 1, car.path.length));
  const points = [
    car.position,
    ...nextNodeIds.map((nodeId) => {
      const point = nodesById.get(nodeId);
      if (!point) throw new Error(`Route references missing node "${nodeId}".`);
      return point;
    }),
  ];
  const chosenSpot = car.chosenSpotId
    ? parkingSpots.find((spot) => spot.id === car.chosenSpotId)
    : undefined;
  if (!chosenSpot) return points;

  const lastPoint = points[points.length - 1];
  if (Math.hypot(lastPoint.x - chosenSpot.position.x, lastPoint.z - chosenSpot.position.z) < 0.1) {
    return points;
  }
  return [...points, chosenSpot.position];
}
