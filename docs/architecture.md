# AutoRoads Architecture

## Boundary

AutoRoads v1 is a stylized autonomous-agent simulation. It is not a perception stack, full driving simulator, or traffic-research engine.

## Runtime Shape

- Browser simulation owns cars, roads, traffic lights, stop signs, scenario controls, and rendering.
- FastAPI backend owns parking inference and model metadata.
- ML training is CLI-driven and writes artifacts into `backend/models/`.

## Data Flow

1. A car approaches its destination or needs to revise parking.
2. The frontend builds candidate parking features from the current scenario.
3. `POST /parking/decide` returns candidate scores, selected spot, baselines, and explanation terms.
4. The frontend updates the selected car and continues simulation locally.

## ML Scope

The neural model predicts candidate parking utility. Training data is synthetic and labeled by an oracle utility function so the first version can be built before real-world data exists.

If no trained PyTorch artifact is present, the backend uses the same feature contract with a deterministic heuristic fallback. That keeps the local demo usable while the model pipeline evolves.

