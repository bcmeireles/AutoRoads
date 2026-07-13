import type { CandidateScore, CarAgent, ParkingSpot, RoadNode, Vec2 } from "../types";

type RouteCar = Pick<
  CarAgent,
  "chosenSpotId" | "path" | "pathIndex" | "position" | "state"
>;
type CandidateCueCar = Pick<CarAgent, "candidateScores" | "decisionRequested" | "state">;
type CarMarkerCar = Pick<CarAgent, "color" | "path" | "pathIndex" | "position" | "state">;

export type SceneTrafficLightPhase = {
  state: "green" | "red";
  durationSeconds: number;
  appliesToNodeIds?: string[];
};

export type SceneTrafficControl =
  | "stop"
  | "traffic-light"
  | { kind: "stop"; stopDurationSeconds: number }
  | {
      kind: "traffic-light";
      programId: string;
      phases: SceneTrafficLightPhase[];
    };

export type SceneControlledNode = Pick<RoadNode, "id" | "position"> & {
  control?: SceneTrafficControl;
};

export type SceneTrafficControlState = {
  kind: "none" | "stop" | "traffic-light";
  signal: "none" | "stop" | "green" | "red";
  canEnter: boolean;
  waitSeconds: number;
  phaseIndex?: number;
  programId?: string;
};

export type CameraPanLimits = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type ParkingMarkerAppearance = {
  baseColor: string;
  edgeColor: string;
  isCandidate: boolean;
  isEligibleCandidate: boolean;
  candidateRank?: number;
  showChosenCue: boolean;
  showNearestBaselineCue: boolean;
  showParkingLetter: boolean;
  showIllegalCue: boolean;
  showInaccessibleCue: boolean;
};

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
  parkingSpots: Pick<ParkingSpot, "id" | "nodeId" | "position">[],
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
  const routeEndNodeId = car.path[car.path.length - 1];
  if (!chosenSpot || car.state === "blocked" || routeEndNodeId !== chosenSpot.nodeId) {
    return points;
  }

  const lastPoint = points[points.length - 1];
  if (Math.hypot(lastPoint.x - chosenSpot.position.x, lastPoint.z - chosenSpot.position.z) < 0.1) {
    return points;
  }
  return [...points, chosenSpot.position];
}

export function controlStateAt(
  node: SceneControlledNode,
  elapsedSeconds: number,
): SceneTrafficControlState {
  if (!node.control) {
    return { kind: "none", signal: "none", canEnter: true, waitSeconds: 0 };
  }

  const control = node.control;
  if (control === "stop") {
    return { kind: "stop", signal: "stop", canEnter: false, waitSeconds: 0.8 };
  }
  if (typeof control !== "string" && control.kind === "stop") {
    return {
      kind: "stop",
      signal: "stop",
      canEnter: false,
      waitSeconds: control.stopDurationSeconds,
    };
  }

  const phases =
    typeof control === "string"
      ? [
          { state: "green" as const, durationSeconds: 7 },
          { state: "red" as const, durationSeconds: 7 },
        ]
      : control.phases;
  const programId = typeof control === "string" ? undefined : control.programId;
  const totalDuration = phases.reduce((total, phase) => total + phase.durationSeconds, 0);
  if (totalDuration <= 0) {
    return {
      kind: "traffic-light",
      signal: "green",
      canEnter: true,
      waitSeconds: 0,
      programId,
    };
  }

  const positionInCycle = positiveModulo(elapsedSeconds, totalDuration);
  let phaseStart = 0;
  const phaseIndex = phases.findIndex((phase) => {
    const phaseEnd = phaseStart + phase.durationSeconds;
    const isActive = positionInCycle < phaseEnd;
    if (!isActive) phaseStart = phaseEnd;
    return isActive;
  });
  const activePhaseIndex = Math.max(0, phaseIndex);
  const phase = phases[activePhaseIndex];
  if (phase.state === "green") {
    return {
      kind: "traffic-light",
      signal: "green",
      canEnter: true,
      waitSeconds: 0,
      phaseIndex: activePhaseIndex,
      programId,
    };
  }

  return {
    kind: "traffic-light",
    signal: "red",
    canEnter: false,
    waitSeconds: secondsUntilGreen(phases, activePhaseIndex, positionInCycle - phaseStart),
    phaseIndex: activePhaseIndex,
    programId,
  };
}

export function parkingMarkerAppearance(
  spot: Pick<ParkingSpot, "legal" | "accessible">,
  options: {
    candidateScore?: CandidateScore;
    isChosen: boolean;
    isNearestBaseline: boolean;
    showPendingCandidate: boolean;
  },
): ParkingMarkerAppearance {
  const isCandidate = Boolean(options.candidateScore) || options.showPendingCandidate;
  return {
    baseColor: !spot.legal ? "#fecaca" : !spot.accessible ? "#cbd5e1" : "#f8fafc",
    edgeColor: !spot.legal ? "#dc2626" : !spot.accessible ? "#475569" : "#94a3b8",
    isCandidate,
    isEligibleCandidate: options.candidateScore?.eligible ?? options.showPendingCandidate,
    candidateRank: options.candidateScore?.rank,
    showChosenCue: options.isChosen,
    showNearestBaselineCue: options.isNearestBaseline,
    showParkingLetter: spot.legal && spot.accessible,
    showIllegalCue: !spot.legal,
    showInaccessibleCue: spot.legal && !spot.accessible,
  };
}

export function cameraFitZoom(width: number, height: number): number {
  const paddedWorldWidth = 214;
  const paddedWorldHeight = 178;
  return clamp(Math.min(width / paddedWorldWidth, height / paddedWorldHeight), 1.65, 5.2);
}

export function clampCameraTarget(target: Vec2, limits: CameraPanLimits): Vec2 {
  return {
    x: clamp(target.x, limits.minX, limits.maxX),
    z: clamp(target.z, limits.minZ, limits.maxZ),
  };
}

export function carHeading(
  car: Pick<CarMarkerCar, "path" | "pathIndex" | "position">,
  nodes: Pick<RoadNode, "id" | "position">[],
): number {
  const nextNodeId = car.path[car.pathIndex + 1] ?? car.path[car.pathIndex];
  const nextNode = nodes.find((node) => node.id === nextNodeId);
  if (!nextNode) return 0;
  const dx = nextNode.position.x - car.position.x;
  const dz = nextNode.position.z - car.position.z;
  if (Math.hypot(dx, dz) < 0.1) return 0;
  return Math.atan2(dx, dz);
}

export function carStateColor(car: Pick<CarMarkerCar, "state">): string {
  if (car.state === "choosing_parking") return "#f97316";
  if (car.state === "parking") return "#f59e0b";
  if (car.state === "parked") return "#10b981";
  if (car.state === "blocked") return "#dc2626";
  return "#38bdf8";
}

export function handleCarMarkerClick(
  event: { stopPropagation: () => void },
  onSelect: () => void,
): void {
  event.stopPropagation();
  onSelect();
}

function secondsUntilGreen(
  phases: SceneTrafficLightPhase[],
  currentPhaseIndex: number,
  phaseElapsed: number,
): number {
  let waitSeconds = phases[currentPhaseIndex].durationSeconds - phaseElapsed;
  for (let offset = 1; offset <= phases.length; offset += 1) {
    const nextPhase = phases[(currentPhaseIndex + offset) % phases.length];
    if (nextPhase.state === "green") return Math.max(0, waitSeconds);
    waitSeconds += nextPhase.durationSeconds;
  }
  return waitSeconds;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
