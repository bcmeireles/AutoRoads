import { Car, Gauge, ParkingCircle, Play, RotateCcw, SlidersHorizontal } from "lucide-react";

import { city } from "../sim/city";
import { routeEtaSeconds, selectedCar, useSimulationStore } from "../state/simulationStore";
import type { ScenarioSettings } from "../types";

const sliderGroups: {
  key: keyof ScenarioSettings;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "trafficDensity", label: "Traffic", min: 0, max: 1, step: 0.01 },
  { key: "parkingScarcity", label: "Scarcity", min: 0, max: 1, step: 0.01 },
  { key: "tripDemand", label: "Demand", min: 0, max: 1, step: 0.01 },
  { key: "driveTimeWeight", label: "Drive", min: 0, max: 1, step: 0.01 },
  { key: "walkDistanceWeight", label: "Walk", min: 0, max: 1, step: 0.01 },
  { key: "priceWeight", label: "Price", min: 0, max: 1, step: 0.01 },
  { key: "availabilityRiskWeight", label: "Availability", min: 0, max: 1, step: 0.01 },
  { key: "congestionWeight", label: "Congestion", min: 0, max: 1, step: 0.01 },
];

export function Dashboard() {
  const state = useSimulationStore();
  const car = selectedCar(state);
  const destination = city.destinations.find((item) => item.id === car.destinationId);
  const selectedSpot = city.parkingSpots.find((spot) => spot.id === car.chosenSpotId);
  const baselineSpot = city.parkingSpots.find((spot) => spot.id === car.baselineSpotId);
  const eta = routeEtaSeconds(car, state.scenario);

  return (
    <aside className="dashboard">
      <section className="toolbar" aria-label="Simulation controls">
        <button type="button" onClick={state.togglePaused} title={state.paused ? "Resume" : "Pause"}>
          <Play size={18} />
        </button>
        <button type="button" onClick={state.reset} title="Reset simulation">
          <RotateCcw size={18} />
        </button>
        <div className="clock">{Math.floor(state.elapsedSeconds)}s</div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <SlidersHorizontal size={17} />
          Scenario
        </div>
        <div className="slider-grid">
          {sliderGroups.map((slider) => (
            <label key={slider.key} className="slider-row">
              <span>{slider.label}</span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={state.scenario[slider.key]}
                onChange={(event) => state.setScenario(slider.key, Number(event.currentTarget.value))}
              />
              <strong>{state.scenario[slider.key].toFixed(2)}</strong>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <Car size={17} />
          Selected Car
        </div>
        <div className="stat-grid">
          <Metric label="Car" value={car.id} />
          <Metric label="State" value={car.state.replace("_", " ")} />
          <Metric label="Destination" value={destination?.name ?? car.destinationId} />
          <Metric label="Route ETA" value={`${eta.toFixed(1)}s`} />
          <Metric label="Wait" value={waitStatus(car.waitReason, car.waitSeconds)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <ParkingCircle size={17} />
          Parking Decision
        </div>
        <div className="stat-grid">
          <Metric label="Chosen" value={selectedSpot?.id ?? "pending"} />
          <Metric label="Nearest baseline" value={baselineSpot?.id ?? "pending"} />
          <Metric label="Model" value={car.modelVersion ?? "waiting"} />
        </div>
        <div className="score-list">
          {(car.candidateScores ?? []).slice(0, 5).map((score) => (
            <div key={score.spot_id} className="score-row">
              <span>{score.rank}. {score.spot_id}</span>
              <strong>{score.score.toFixed(1)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <Gauge size={17} />
          Explanation
        </div>
        <div className="explanation-list">
          {(car.explanation ?? []).length === 0 ? (
            <p className="muted">Select a car and wait for a parking decision.</p>
          ) : (
            car.explanation!.map((term) => (
              <div key={`${term.feature}-${term.impact}`} className="explanation-row">
                <span>{term.feature.replaceAll("_", " ")}</span>
                <strong className={term.direction}>{term.impact.toFixed(2)}</strong>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function waitStatus(reason?: string, waitSeconds = 0): string {
  if (!reason || waitSeconds <= 0) return "clear";
  return `${reason} (${waitSeconds.toFixed(1)}s)`;
}
