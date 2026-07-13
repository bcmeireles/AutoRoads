import { useEffect, useRef, useState } from "react";
import { Car, Gauge, ParkingCircle, Play, RefreshCw, RotateCcw, SlidersHorizontal } from "lucide-react";

import { fetchModelMetrics, type ModelMetrics } from "../api/parking";
import { city } from "../sim/city";
import { routeEtaSeconds, selectedCar, useSimulationStore } from "../state/simulationStore";
import type { ScenarioSettings } from "../types";
import {
  decisionModeLabel,
  metricValue,
  normalizedObjectiveWeights,
  routeProgressPercent,
  startMetricsPolling,
  type MetricsPollingController,
  waitStatus,
} from "./dashboardHelpers";

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
  return (
    <aside className="dashboard">
      <SimulationToolbar />
      <ScenarioPanel />
      <SelectedCarPanel />
      <ParkingDecisionPanel />
      <ModelMetricsPanel />
      <ExplanationPanel />
    </aside>
  );
}

function SimulationToolbar() {
  const elapsedSeconds = useSimulationStore((state) => state.elapsedSeconds);
  const paused = useSimulationStore((state) => state.paused);
  const togglePaused = useSimulationStore((state) => state.togglePaused);
  const reset = useSimulationStore((state) => state.reset);

  return (
    <section className="toolbar" aria-label="Simulation controls">
      <button type="button" onClick={togglePaused} title={paused ? "Resume" : "Pause"}>
        <Play size={18} />
      </button>
      <button type="button" onClick={reset} title="Reset simulation">
        <RotateCcw size={18} />
      </button>
      <div className="clock">{Math.floor(elapsedSeconds)}s</div>
    </section>
  );
}

function ScenarioPanel() {
  const scenario = useSimulationStore((state) => state.scenario);
  const setScenario = useSimulationStore((state) => state.setScenario);

  return (
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
              value={scenario[slider.key]}
              onChange={(event) => setScenario(slider.key, Number(event.currentTarget.value))}
            />
            <strong>{scenario[slider.key].toFixed(2)}</strong>
          </label>
        ))}
      </div>
      <div className="weight-readout" aria-label="Normalized objective weights">
        {normalizedObjectiveWeights(scenario).map((weight) => (
          <span
            key={weight.key}
            aria-label={`${weight.label} normalized weight: ${weight.value.toFixed(2)}`}
          >
            {weight.shortLabel} {weight.value.toFixed(2)}
          </span>
        ))}
      </div>
    </section>
  );
}

function SelectedCarPanel() {
  const cars = useSimulationStore((state) => state.cars);
  const selectedCarId = useSimulationStore((state) => state.selectedCarId);
  const scenario = useSimulationStore((state) => state.scenario);
  const selectCar = useSimulationStore((state) => state.selectCar);
  const car = selectedCar({ cars, selectedCarId });
  const destination = city.destinations.find((item) => item.id === car.destinationId);
  const eta = routeEtaSeconds(car, scenario);
  const progress = routeProgressPercent(car);

  return (
    <section className="panel">
      <div className="panel-title">
        <Car size={17} />
        Selected Car
      </div>
      <select
        className="car-select"
        value={car.id}
        onChange={(event) => selectCar(event.currentTarget.value)}
        aria-label="Selected car"
      >
        {cars.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.id} - {candidate.state.replace("_", " ")}
          </option>
        ))}
      </select>
      <div className="stat-grid">
        <Metric label="Car" value={car.id} />
        <Metric label="State" value={car.state.replace("_", " ")} />
        <Metric label="Destination" value={destination?.name ?? car.destinationId} />
        <Metric label="Route ETA" value={`${eta.toFixed(1)}s`} />
        <Metric label="Progress" value={`${progress.toFixed(0)}%`} />
        <Metric label="Wait" value={waitStatus(car.waitSeconds)} />
      </div>
      <div className="progress-track" aria-label="Selected car route progress">
        <span style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}

function ParkingDecisionPanel() {
  const car = useSimulationStore(selectedCar);
  const selectedSpot = city.parkingSpots.find((spot) => spot.id === car.chosenSpotId);
  const baselineSpot = city.parkingSpots.find((spot) => spot.id === car.baselineSpotId);
  const randomSpot = city.parkingSpots.find((spot) => spot.id === car.randomBaselineSpotId);

  return (
    <section className="panel">
      <div className="panel-title">
        <ParkingCircle size={17} />
        Parking Decision
      </div>
      <div className="stat-grid">
        <Metric label="Chosen" value={selectedSpot?.id ?? "pending"} />
        <Metric label="Nearest baseline" value={baselineSpot?.id ?? "pending"} />
        <Metric label="Random baseline" value={randomSpot?.id ?? "pending"} />
        <Metric label="Mode" value={decisionModeLabel(car)} />
        <Metric label="Model" value={car.modelVersion ?? "waiting"} />
      </div>
      <div className="score-list">
        {(car.candidateScores ?? []).slice(0, 5).map((score) => (
          <div key={score.spot_id} className="score-row">
            <span>{score.rank}. {score.spot_id}{score.eligible ? "" : " - ineligible"}</span>
            <strong>{score.score.toFixed(1)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModelMetricsPanel() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [metricsStatus, setMetricsStatus] = useState<"idle" | "loading" | "error">("idle");
  const polling = useRef<MetricsPollingController | null>(null);

  useEffect(() => {
    const controller = startMetricsPolling({
      load: fetchModelMetrics,
      onLoading: () => setMetricsStatus("loading"),
      onSuccess: (value) => {
        setMetrics(value);
        setMetricsStatus("idle");
      },
      onError: () => setMetricsStatus("error"),
    });
    polling.current = controller;

    return () => {
      controller.stop();
      polling.current = null;
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-title panel-title-action">
        <Gauge size={17} />
        Model Metrics
        <button
          type="button"
          onClick={() => void polling.current?.refresh()}
          title="Refresh model metrics"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="stat-grid">
        <Metric label="Version" value={metricValue(metrics?.model_version, "waiting")} />
        <Metric label="Trained" value={metrics ? (metrics.trained ? "yes" : "no") : "waiting"} />
        <Metric label="Outcome" value={metricValue(metrics?.parking_outcome_score)} />
        <Metric label="Samples" value={metricValue(metrics?.samples)} />
        <Metric label="Delta nearest" value={metricValue(metrics?.model_delta_vs_nearest)} />
        <Metric label="Delta random" value={metricValue(metrics?.model_delta_vs_random)} />
      </div>
      {metricsStatus === "error" ? <p className="muted">Metrics unavailable.</p> : null}
    </section>
  );
}

function ExplanationPanel() {
  const car = useSimulationStore(selectedCar);

  return (
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
