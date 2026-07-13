import { create } from "zustand";

import { decideParking, localFallbackDecision } from "../api/parking";
import {
  applyParkingDecisionToCar,
  initializeCarAgent,
  transitionCarAgents,
} from "../sim/agents";
import { city, initialCars } from "../sim/city";
import { estimateRouteSeconds } from "../sim/routing";
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
  requestParkingDecision: (carId: string, requestId?: string) => Promise<void>;
};

const destinationById = (id: string) => city.destinations.find((destination) => destination.id === id)!;

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

const createInitialCars = () => initialCars.map((car) => initializeCarAgent(car));

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  elapsedSeconds: 0,
  selectedCarId: "car-1",
  paused: false,
  cars: createInitialCars(),
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
      cars: createInitialCars(),
      selectedCarId: "car-1",
      paused: false,
      scenario: defaultScenario,
    }),
  togglePaused: () => set((state) => ({ paused: !state.paused })),
  tick: (delta) => {
    const state = get();
    if (state.paused) return;
    const elapsedSeconds = state.elapsedSeconds + delta;

    const transition = transitionCarAgents({
      cars: state.cars,
      city,
      scenario: state.scenario,
      elapsedSeconds,
      delta,
    });

    set({ elapsedSeconds, cars: transition.cars });
    for (const sideEffect of transition.sideEffects) {
      if (sideEffect.type === "requestParkingDecision") {
        void get().requestParkingDecision(sideEffect.carId, sideEffect.requestId);
      }
    }
  },
  requestParkingDecision: async (carId, requestId) => {
    const state = get();
    const car = state.cars.find((candidate) => candidate.id === carId);
    if (!car) return;
    if (requestId && car.parkingDecisionRequestId !== requestId) return;
    if (!requestId && (car.decisionRequested || car.parkingDecisionRequestId)) return;

    const destination = destinationById(car.destinationId);
    let decision;
    try {
      decision = await decideParking(city, car, destination, state.scenario);
    } catch {
      decision = localFallbackDecision(city, car, destination, state.scenario);
    }

    set((latest) => ({
      cars: latest.cars.map((candidate) => {
        if (candidate.id !== carId) return candidate;
        if (requestId && candidate.parkingDecisionRequestId !== requestId) return candidate;
        return applyParkingDecisionToCar(candidate, city, decision);
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
