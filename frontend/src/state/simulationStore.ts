import { create } from "zustand";

import { decideParking, localFallbackDecision } from "../api/parking";
import { city, initialCars } from "../sim/city";
import { estimateRouteSeconds, findRoute } from "../sim/routing";
import {
  advanceTrafficControlWait,
  completeTrafficControlEntry,
  hasActiveTrafficControlWait,
  resolveTrafficControlArrival,
} from "../sim/trafficControls";
import type { CarAgent, ScenarioSettings } from "../types";

type SimulationStore = {
  elapsedSeconds: number;
  selectedCarId: string;
  paused: boolean;
  cars: CarAgent[];
  scenario: ScenarioSettings;
  selectCar: (carId: string) => void;
  setScenario: (key: keyof ScenarioSettings, value: number) => void;
  reset: () => void;
  togglePaused: () => void;
  tick: (delta: number) => void;
  requestParkingDecision: (carId: string) => Promise<void>;
};

const destinationById = (id: string) => city.destinations.find((destination) => destination.id === id)!;
const nodeById = (id: string) => city.nodes.find((node) => node.id === id)!;
const spotById = (id: string) => city.parkingSpots.find((spot) => spot.id === id)!;

const defaultScenario: ScenarioSettings = {
  trafficDensity: 0.42,
  parkingScarcity: 0.48,
  tripDemand: 0.55,
  driveTimeWeight: 0.35,
  walkDistanceWeight: 0.25,
  priceWeight: 0.15,
  availabilityRiskWeight: 0.15,
  congestionWeight: 0.1,
};

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  elapsedSeconds: 0,
  selectedCarId: "car-1",
  paused: false,
  cars: initialCars,
  scenario: defaultScenario,
  selectCar: (carId) => set({ selectedCarId: carId }),
  setScenario: (key, value) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        [key]: value,
      },
    })),
  reset: () =>
    set({
      elapsedSeconds: 0,
      cars: initialCars.map((car) => ({ ...car, position: { ...car.position } })),
      selectedCarId: "car-1",
      paused: false,
      scenario: defaultScenario,
    }),
  togglePaused: () => set((state) => ({ paused: !state.paused })),
  tick: (delta) => {
    const state = get();
    if (state.paused) return;
    const elapsedSeconds = state.elapsedSeconds + delta;
    const trafficMultiplier = 1 - state.scenario.trafficDensity * 0.38;

    const cars: CarAgent[] = state.cars.map((car) => {
      if (car.state === "parked" || car.state === "choosing_parking") return car;
      if (hasActiveTrafficControlWait(car)) {
        const waitingNode = car.waitingForControlNodeId ? nodeById(car.waitingForControlNodeId) : undefined;
        return {
          ...car,
          ...advanceTrafficControlWait(car, delta, waitingNode),
        };
      }

      const nextNodeId = car.path[car.pathIndex + 1];
      if (!nextNodeId) {
        if (car.chosenSpotId) {
          return {
            ...car,
            state: "parked",
            position: { ...spotById(car.chosenSpotId).position },
          };
        }
        if (!car.decisionRequested) {
          void get().requestParkingDecision(car.id);
          return { ...car, state: "choosing_parking", decisionRequested: true };
        }
        return car;
      }

      const nextNode = nodeById(nextNodeId);
      const dx = nextNode.position.x - car.position.x;
      const dz = nextNode.position.z - car.position.z;
      const distance = Math.hypot(dx, dz);
      const speedPerSecond = Math.max(2, car.speed * trafficMultiplier);
      const step = speedPerSecond * delta;

      if (distance <= step) {
        const arrival = resolveTrafficControlArrival({
          car,
          nextNode,
          tickStartedAtSeconds: state.elapsedSeconds,
          distanceToNode: distance,
          speedPerSecond,
        });
        if (!arrival.canEnter) {
          return {
            ...car,
            ...arrival.agent,
            state: car.chosenSpotId ? "parking" : "driving",
          };
        }

        return {
          ...car,
          ...completeTrafficControlEntry(arrival.agent),
          position: { ...nextNode.position },
          currentNodeId: nextNodeId,
          pathIndex: car.pathIndex + 1,
        };
      }

      return {
        ...car,
        state: car.chosenSpotId ? "parking" : "driving",
        position: {
          x: car.position.x + (dx / distance) * step,
          z: car.position.z + (dz / distance) * step,
        },
      };
    });

    set({ elapsedSeconds, cars });
  },
  requestParkingDecision: async (carId) => {
    const state = get();
    const car = state.cars.find((candidate) => candidate.id === carId);
    if (!car) return;

    const destination = destinationById(car.destinationId);
    let decision;
    try {
      decision = await decideParking(city, car, destination, state.scenario);
    } catch {
      decision = localFallbackDecision(city, car, destination, state.scenario);
    }

    const chosenSpotId = decision.selected_spot_id ?? undefined;
    set((latest) => ({
      cars: latest.cars.map((candidate) => {
        if (candidate.id !== carId) return candidate;
        const spot = chosenSpotId ? spotById(chosenSpotId) : undefined;
        const path = spot ? findRoute(city, candidate.currentNodeId, spot.nodeId) : [];
        return {
          ...candidate,
          chosenSpotId,
          baselineSpotId: decision.baselines.find((baseline) => baseline.strategy === "nearest")?.spot_id ?? undefined,
          modelVersion: decision.model_version,
          explanation: decision.explanation,
          candidateScores: decision.candidate_scores,
          path: path.length > 0 ? path : candidate.path,
          pathIndex: 0,
          clearedControlNodeId: undefined,
          state: path.length > 0 ? "parking" : "blocked",
        };
      }),
    }));
  },
}));

export function selectedCar(state: Pick<SimulationStore, "cars" | "selectedCarId">) {
  return state.cars.find((car) => car.id === state.selectedCarId) ?? state.cars[0];
}

export function routeEtaSeconds(car: CarAgent, scenario: ScenarioSettings): number {
  return estimateRouteSeconds(city, car.path.slice(car.pathIndex), scenario.trafficDensity);
}
