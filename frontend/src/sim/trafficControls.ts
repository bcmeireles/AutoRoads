import type { CarAgent, RoadNode, TrafficLightPhase } from "../types";

const WAIT_EPSILON_SECONDS = 1e-9;

export type TrafficControlState = {
  kind: "none" | "stop" | "traffic-light";
  signal: "none" | "stop" | "green" | "red";
  canEnter: boolean;
  waitSeconds: number;
  reason?: string;
  phaseIndex?: number;
  programId?: string;
};

export type TrafficControlAgentState = Pick<
  CarAgent,
  | "currentNodeId"
  | "waitSeconds"
  | "waitReason"
  | "waitingForControlNodeId"
  | "clearedControlNodeId"
>;

export type TrafficControlArrival = {
  canEnter: boolean;
  arrivalSeconds: number;
  agent: TrafficControlAgentState;
};

export function controlStateAt(
  node: RoadNode,
  elapsedSeconds: number,
  approachNodeId?: string,
): TrafficControlState {
  if (!node.control) {
    return { kind: "none", signal: "none", canEnter: true, waitSeconds: 0 };
  }

  if (node.control.kind === "stop") {
    return {
      kind: "stop",
      signal: "stop",
      canEnter: false,
      waitSeconds: node.control.stopDurationSeconds,
      reason: `Stop sign at ${node.id}`,
    };
  }

  const phases = node.control.phases;
  const totalDuration = phases.reduce((total, phase) => total + phase.durationSeconds, 0);
  if (totalDuration <= 0) {
    return { kind: "traffic-light", signal: "green", canEnter: true, waitSeconds: 0 };
  }

  const positionInCycle = positiveModulo(elapsedSeconds, totalDuration);
  let elapsedInPhases = 0;
  const phaseIndex = phases.findIndex((phase) => {
    const phaseEnd = elapsedInPhases + phase.durationSeconds;
    const isActive = positionInCycle < phaseEnd;
    if (!isActive) elapsedInPhases = phaseEnd;
    return isActive;
  });
  const phase = phases[Math.max(0, phaseIndex)];
  const phaseElapsed = positionInCycle - elapsedInPhases;
  const appliesToApproach = phaseAppliesTo(phase, approachNodeId);

  if (phase.state === "green" || !appliesToApproach) {
    return {
      kind: "traffic-light",
      signal: "green",
      canEnter: true,
      waitSeconds: 0,
      phaseIndex,
      programId: node.control.programId,
    };
  }

  return {
    kind: "traffic-light",
    signal: "red",
    canEnter: false,
    waitSeconds: secondsUntilGreen(phases, phaseIndex, phaseElapsed, approachNodeId),
    reason: `Red light at ${node.id}`,
    phaseIndex,
    programId: node.control.programId,
  };
}

export function requiredWaitSeconds(
  car: Pick<CarAgent, "currentNodeId">,
  nextNode: RoadNode,
  elapsedSeconds: number,
): number {
  const state = controlStateAt(nextNode, elapsedSeconds, car.currentNodeId);
  return state.canEnter ? 0 : state.waitSeconds;
}

export function hasActiveTrafficControlWait(car: TrafficControlAgentState): boolean {
  return (car.waitSeconds ?? 0) > 0;
}

export function advanceTrafficControlWait(
  car: TrafficControlAgentState,
  deltaSeconds: number,
  waitingNode?: RoadNode,
): TrafficControlAgentState {
  const remainingWait = Math.max(0, (car.waitSeconds ?? 0) - Math.max(0, deltaSeconds));
  const waitSeconds = remainingWait <= WAIT_EPSILON_SECONDS ? 0 : remainingWait;
  const completedStopNodeId =
    waitSeconds === 0 &&
    waitingNode &&
    waitingNode.id === car.waitingForControlNodeId &&
    waitingNode.control?.kind === "stop"
      ? waitingNode.id
      : undefined;

  return {
    ...car,
    waitSeconds,
    waitReason: waitSeconds > 0 ? car.waitReason : undefined,
    waitingForControlNodeId: waitSeconds > 0 ? car.waitingForControlNodeId : undefined,
    clearedControlNodeId: completedStopNodeId ?? car.clearedControlNodeId,
  };
}

export function resolveTrafficControlArrival(input: {
  car: TrafficControlAgentState;
  nextNode: RoadNode;
  tickStartedAtSeconds: number;
  distanceToNode: number;
  speedPerSecond: number;
}): TrafficControlArrival {
  const { car, nextNode } = input;
  const travelSeconds =
    Math.max(0, input.distanceToNode) / Math.max(Number.EPSILON, input.speedPerSecond);
  const arrivalSeconds = input.tickStartedAtSeconds + travelSeconds;

  if (car.clearedControlNodeId === nextNode.id) {
    return { canEnter: true, arrivalSeconds, agent: car };
  }

  const controlState = controlStateAt(nextNode, arrivalSeconds, car.currentNodeId);
  if (controlState.canEnter) {
    return { canEnter: true, arrivalSeconds, agent: car };
  }

  return {
    canEnter: false,
    arrivalSeconds,
    agent: {
      ...car,
      waitSeconds: controlState.waitSeconds,
      waitReason: controlState.reason,
      waitingForControlNodeId: nextNode.id,
    },
  };
}

export function completeTrafficControlEntry(
  car: TrafficControlAgentState,
): TrafficControlAgentState {
  return {
    ...car,
    waitSeconds: 0,
    waitReason: undefined,
    waitingForControlNodeId: undefined,
    clearedControlNodeId: undefined,
  };
}

function secondsUntilGreen(
  phases: TrafficLightPhase[],
  currentPhaseIndex: number,
  phaseElapsed: number,
  approachNodeId?: string,
): number {
  let waitSeconds = phases[currentPhaseIndex].durationSeconds - phaseElapsed;
  for (let offset = 1; offset <= phases.length; offset += 1) {
    const nextPhase = phases[(currentPhaseIndex + offset) % phases.length];
    if (nextPhase.state === "green" || !phaseAppliesTo(nextPhase, approachNodeId)) {
      return Math.max(0, waitSeconds);
    }
    waitSeconds += nextPhase.durationSeconds;
  }
  return waitSeconds;
}

function phaseAppliesTo(phase: TrafficLightPhase, approachNodeId?: string): boolean {
  return !approachNodeId || !phase.appliesToNodeIds || phase.appliesToNodeIds.includes(approachNodeId);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
