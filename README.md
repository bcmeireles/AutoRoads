# AutoRoads

AutoRoads is a private, local-only AI/ML project: a stylized 2.5D city simulation where autonomous cars obey simple road rules and ask a Python ML service to choose parking.

The v1 goal is a credible portfolio demo, not a photorealistic autonomous-driving simulator. It does not claim perception, sensor fusion, CARLA-level driving, or SUMO-level traffic fidelity.

## What Runs Today

- `frontend/`: Vite + React + TypeScript + React Three Fiber city simulation.
- `backend/`: FastAPI parking decision API with model hooks and a heuristic fallback.
- `backend/ml/`: synthetic data generation and PyTorch training/evaluation scripts.
- GitHub project board: epics/tasks for the full v1 roadmap.

## Local Setup

Install frontend dependencies:

```bash
npm --prefix frontend install
```

Create a Python environment and install the API dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

Optional ML training dependencies:

```bash
python -m pip install -r backend/requirements-ml.txt
```

Run both apps:

```bash
npm run dev
```

Open the frontend at `http://127.0.0.1:5173`. The backend runs at `http://127.0.0.1:8000`.

## Useful Commands

```bash
npm run check
npm run test
python -m backend.ml.generate_dataset --samples 5000
python -m backend.ml.train --epochs 20
```

## Architecture

The frontend owns the frame-by-frame simulation loop. It calls the backend only when an agent needs a parking decision. The backend scores candidate parking spots, returns a chosen spot, compares against nearest/random baselines, and reports explanation terms based on local feature perturbations.

The first ML module is intentionally narrow: it chooses parking, not low-level driving. Cars still use deterministic routing and traffic-rule logic for movement.

## Roadmap

Future work is organized by GitHub milestones from V1 through V6. The long-term direction is a live, inspectable city simulation with district scenarios, procedural district expansion, NPC schedules, a district editor, and city-level history/metrics.

See [docs/roadmap.md](docs/roadmap.md) for the version plan.
