import type {
  CandidateScore,
  CarAgent,
  CityMap,
  ExplanationTerm,
  ScenarioSettings,
} from "../types";
import { findRoute } from "./routing";

export type AgentSideEffect = {
  type: "requestParkingDecision";
  carId: string;
  requestId: string;
};

export type CarTransitionInput = {
  car: CarAgent;
  city: CityMap;
  scenario: ScenarioSettings;
  elapsedSeconds: number;
  delta: number;
};

export type CarTransitionResult = {
  car: CarAgent;
  sideEffect?: AgentSideEffect;
};

type ParkingDecisionForAgent = {
  selected_spot_id: string | null;
  candidate_scores: CandidateScore[];
  baselines: { strategy: "nearest" | "random"; spot_id: string | null; score: number | null }[];
  explanation: ExplanationTerm[];
  model_version: string;
};

export function initializeCarAgent(car: CarAgent): CarAgent {
  return {
    ...car,
    position: { ...car.position },
    path: [...car.path],
    pathIndex: 0,
    state: "spawned",
    chosenSpotId: undefined,
    baselineSpotId: undefined,
    modelVersion: undefined,
    explanation: undefined,
    candidateScores: undefined,
    decisionRequested: false,
    parkingDecisionRequestId: undefined,
    waitSeconds: 0,
  };
}

export function transitionCarAgent({
  car,
  city,
  scenario,
  elapsedSeconds,
  delta,
}: CarTransitionInput): CarTransitionResult {
  switch (car.state) {
    case "spawned":
      return { car: { ...car, state: "routing", pathIndex: 0, waitSeconds: 0 } };
    case "routing":
      return routeToDestination(car, city);
    case "driving":
      return advanceAlongPath(car, city, scenario, elapsedSeconds, delta);
    case "choosing_parking":
      return ensureParkingDecisionRequested(car, elapsedSeconds);
    case "parking":
      return advanceAlongPath(car, city, scenario, elapsedSeconds, delta);
    case "parked":
    case "blocked":
      return { car };
    default:
      return { car: blockCar(car) };
  }
}

export function transitionCarAgents(input: {
  cars: CarAgent[];
  city: CityMap;
  scenario: ScenarioSettings;
  elapsedSeconds: number;
  delta: number;
}): { cars: CarAgent[]; sideEffects: AgentSideEffect[] } {
  const sideEffects: AgentSideEffect[] = [];
  const cars = input.cars.map((car) => {
    const result = transitionCarAgent({ ...input, car });
    if (result.sideEffect) sideEffects.push(result.sideEffect);
    return result.car;
  });

  return { cars, sideEffects };
}

export function applyParkingDecisionToCar(
  car: CarAgent,
  city: CityMap,
  decision: ParkingDecisionForAgent,
): CarAgent {
  const chosenSpotId = decision.selected_spot_id ?? undefined;
  const baselineSpotId =
    decision.baselines.find((baseline) => baseline.strategy === "nearest")?.spot_id ?? undefined;
  const spot = chosenSpotId ? city.parkingSpots.find((candidate) => candidate.id === chosenSpotId) : undefined;
  const path = spot ? findRoute(city, car.currentNodeId, spot.nodeId) : [];
  const hasParkingRoute = Boolean(spot) && path.length > 0;

  return {
    ...car,
    chosenSpotId,
    baselineSpotId,
    modelVersion: decision.model_version,
    explanation: decision.explanation,
    candidateScores: decision.candidate_scores,
    path: hasParkingRoute ? path : car.path,
    pathIndex: 0,
    state: hasParkingRoute ? "parking" : "blocked",
    decisionRequested: false,
    parkingDecisionRequestId: undefined,
    waitSeconds: 0,
  };
}

function routeToDestination(car: CarAgent, city: CityMap): CarTransitionResult {
  const destination = city.destinations.find((candidate) => candidate.id === car.destinationId);
  if (!destination) return { car: blockCar(car) };

  const path = findRoute(city, car.currentNodeId, destination.nodeId);
  if (path.length === 0) return { car: blockCar(car) };

  return {
    car: {
      ...car,
      path,
      pathIndex: 0,
      state: "driving",
      waitSeconds: 0,
    },
  };
}

function advanceAlongPath(
  car: CarAgent,
  city: CityMap,
  scenario: ScenarioSettings,
  elapsedSeconds: number,
  delta: number,
): CarTransitionResult {
  if (car.waitSeconds && car.waitSeconds > 0) {
    return {
      car: {
        ...car,
        waitSeconds: Math.max(0, car.waitSeconds - Math.max(0, delta)),
      },
    };
  }

  const nextNodeId = car.path[car.pathIndex + 1];
  if (!nextNodeId) {
    if (car.state === "parking") return parkCar(car, city);
    if (car.path.length === 0) return { car: blockCar(car) };
    return ensureParkingDecisionRequested(car, elapsedSeconds);
  }

  const nextNode = city.nodes.find((node) => node.id === nextNodeId);
  if (!nextNode) return { car: blockCar(car) };

  const dx = nextNode.position.x - car.position.x;
  const dz = nextNode.position.z - car.position.z;
  const distance = Math.hypot(dx, dz);
  const trafficMultiplier = 1 - scenario.trafficDensity * 0.38;
  const step = Math.max(2, car.speed * trafficMultiplier) * Math.max(0, delta);

  if (distance === 0 || distance <= step) {
    return {
      car: {
        ...car,
        state: car.state,
        position: { ...nextNode.position },
        currentNodeId: nextNodeId,
        pathIndex: car.pathIndex + 1,
        waitSeconds: waitForControl(city, nextNodeId, elapsedSeconds),
      },
    };
  }

  return {
    car: {
      ...car,
      state: car.state,
      position: {
        x: car.position.x + (dx / distance) * step,
        z: car.position.z + (dz / distance) * step,
      },
    },
  };
}

function ensureParkingDecisionRequested(car: CarAgent, elapsedSeconds: number): CarTransitionResult {
  const requestId = car.parkingDecisionRequestId ?? parkingRequestId(car, elapsedSeconds);
  const nextCar: CarAgent = {
    ...car,
    state: "choosing_parking",
    decisionRequested: true,
    parkingDecisionRequestId: requestId,
  };

  if (car.decisionRequested || car.parkingDecisionRequestId) {
    return { car: nextCar };
  }

  return {
    car: nextCar,
    sideEffect: {
      type: "requestParkingDecision",
      carId: car.id,
      requestId,
    },
  };
}

function parkCar(car: CarAgent, city: CityMap): CarTransitionResult {
  const spot = car.chosenSpotId
    ? city.parkingSpots.find((candidate) => candidate.id === car.chosenSpotId)
    : undefined;
  if (!spot) return { car: blockCar(car) };

  return {
    car: {
      ...car,
      state: "parked",
      position: { ...spot.position },
      currentNodeId: spot.nodeId,
      waitSeconds: 0,
    },
  };
}

function blockCar(car: CarAgent): CarAgent {
  return {
    ...car,
    state: "blocked",
    decisionRequested: false,
    parkingDecisionRequestId: undefined,
    waitSeconds: 0,
  };
}

function waitForControl(city: CityMap, nodeId: string, elapsedSeconds: number): number {
  const node = city.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.control === "stop") return 0.8;
  if (node?.control === "traffic-light") {
    const phase = Math.floor(elapsedSeconds / 7) % 2;
    return phase === 0 ? 0 : 1.8;
  }
  return 0;
}

function parkingRequestId(car: CarAgent, elapsedSeconds: number): string {
  return `parking-${car.id}-${Math.max(0, Math.round(elapsedSeconds * 1000))}`;
}
