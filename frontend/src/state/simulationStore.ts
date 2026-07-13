import { create } from "zustand";

import { decideParking, localFallbackDecision } from "../api/parking";
import { city, initialCars } from "../sim/city";
import { estimateRouteSeconds, findRoute } from "../sim/routing";
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
const inFlightParkingDecisions = new Set<string>();

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

    const carsNeedingParking: string[] = [];
    const cars: CarAgent[] = state.cars.map((car) => {
      if (car.state === "parked" || car.state === "choosing_parking") return car;
      if (car.waitSeconds && car.waitSeconds > 0) {
        return { ...car, waitSeconds: Math.max(0, car.waitSeconds - delta) };
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
          carsNeedingParking.push(car.id);
          return {
            ...car,
            state: "choosing_parking",
            decisionRequested: true,
            parkingDecisionStatus: "pending",
            parkingDecisionError: undefined,
          };
        }
        return car;
      }

      const nextNode = nodeById(nextNodeId);
      const dx = nextNode.position.x - car.position.x;
      const dz = nextNode.position.z - car.position.z;
      const distance = Math.hypot(dx, dz);
      const step = Math.max(2, car.speed * trafficMultiplier) * delta;

      if (distance <= step) {
        const waitSeconds = waitForControl(nextNodeId, elapsedSeconds);
        return {
          ...car,
          position: { ...nextNode.position },
          currentNodeId: nextNodeId,
          pathIndex: car.pathIndex + 1,
          waitSeconds,
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
    for (const carId of carsNeedingParking) {
      void get().requestParkingDecision(carId);
    }
  },
  requestParkingDecision: async (carId) => {
    const state = get();
    const car = state.cars.find((candidate) => candidate.id === carId);
    if (!car || inFlightParkingDecisions.has(carId)) return;

    inFlightParkingDecisions.add(carId);
    set((latest) => ({
      cars: latest.cars.map((candidate) =>
        candidate.id === carId
          ? {
              ...candidate,
              state: "choosing_parking",
              decisionRequested: true,
              parkingDecisionStatus: "pending",
              parkingDecisionError: undefined,
            }
          : candidate,
      ),
    }));

    const destination = destinationById(car.destinationId);
    let decision;
    let status: "backend" | "fallback" = "backend";
    let decisionError: string | undefined;
    try {
      decision = await decideParking(city, car, destination, state.scenario);
    } catch (error) {
      decision = localFallbackDecision(city, car, destination, state.scenario);
      status = "fallback";
      decisionError = error instanceof Error ? error.message : "Parking API request failed.";
    } finally {
      inFlightParkingDecisions.delete(carId);
    }

    const chosenSpotId = decision.selected_spot_id ?? undefined;
    set((latest) => ({
      cars: latest.cars.map((candidate) => {
        if (candidate.id !== carId) return candidate;
        if (candidate.state !== "choosing_parking" || !candidate.decisionRequested) return candidate;

        const spot = chosenSpotId
          ? city.parkingSpots.find((parkingSpot) => parkingSpot.id === chosenSpotId)
          : undefined;
        const path = spot ? findRoute(city, candidate.currentNodeId, spot.nodeId) : [];
        const blockedReason = !chosenSpotId
          ? "No eligible parking spot was selected."
          : !spot
            ? `Selected parking spot ${chosenSpotId} does not exist.`
            : path.length === 0
              ? `No route exists to selected parking spot ${chosenSpotId}.`
              : undefined;
        return {
          ...candidate,
          chosenSpotId,
          baselineSpotId: decision.baselines.find((baseline) => baseline.strategy === "nearest")?.spot_id ?? undefined,
          randomBaselineSpotId:
            decision.baselines.find((baseline) => baseline.strategy === "random")?.spot_id ?? undefined,
          modelVersion: decision.model_version,
          explanation: decision.explanation,
          candidateScores: decision.candidate_scores,
          path: path.length > 0 ? path : candidate.path,
          pathIndex: 0,
          state: blockedReason ? "blocked" : "parking",
          decisionRequested: false,
          parkingDecisionStatus: blockedReason ? "blocked" : status,
          parkingDecisionError: blockedReason ?? decisionError,
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

function waitForControl(nodeId: string, elapsedSeconds: number): number {
  const node = nodeById(nodeId);
  if (node.control === "stop") return 0.8;
  if (node.control === "traffic-light") {
    const phase = Math.floor(elapsedSeconds / 7) % 2;
    return phase === 0 ? 0 : 1.8;
  }
  return 0;
}
