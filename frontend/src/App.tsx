import { CityScene } from "./components/CityScene";
import { Dashboard } from "./components/Dashboard";

export function App() {
  return (
    <main className="app-shell">
      <section className="scene-shell" aria-label="AutoRoads city simulation">
        <div className="brand-strip">
          <div>
            <h1>AutoRoads</h1>
            <p>2.5D autonomous city simulation with ML-assisted parking decisions</p>
          </div>
          <span>Local V1</span>
        </div>
        <CityScene />
      </section>
      <Dashboard />
    </main>
  );
}

