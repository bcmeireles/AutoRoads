from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.app.model import ParkingDecisionEngine
from backend.app.oracle import nearest_baseline, random_baseline
from backend.app.schemas import (
    BaselinePick,
    HealthResponse,
    ModelMetricsResponse,
    ParkingDecisionRequest,
    ParkingDecisionResponse,
)


app = FastAPI(title="AutoRoads Parking API", version="0.1.0")
engine = ParkingDecisionEngine()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True, model_version=engine.model_version)


@app.get("/model/metrics", response_model=ModelMetricsResponse)
def model_metrics() -> ModelMetricsResponse:
    return engine.metrics()


@app.post("/parking/decide", response_model=ParkingDecisionResponse)
def decide_parking(request: ParkingDecisionRequest) -> ParkingDecisionResponse:
    if not request.candidates:
        raise HTTPException(status_code=400, detail="At least one parking candidate is required.")

    ranked = engine.score(request)
    selected = next((item.candidate for item in ranked if item.eligible), None)
    nearest_candidate, nearest_score = nearest_baseline(request)
    random_candidate, random_score = random_baseline(request)

    return ParkingDecisionResponse(
        selected_spot_id=selected.id if selected else None,
        candidate_scores=engine.candidate_scores(request),
        baselines=[
            BaselinePick(
                strategy="nearest",
                spot_id=nearest_candidate.id if nearest_candidate else None,
                score=nearest_score,
            ),
            BaselinePick(
                strategy="random",
                spot_id=random_candidate.id if random_candidate else None,
                score=random_score,
            ),
        ],
        explanation=engine.explain(request, selected),
        model_version=engine.model_version,
    )

