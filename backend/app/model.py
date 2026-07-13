from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from backend.app.feature_engineering import FEATURE_NAMES, candidate_feature_map
from backend.app.oracle import INELIGIBLE_SCORE, is_eligible, score_candidate
from backend.app.schemas import (
    CandidateScore,
    ExplanationTerm,
    ModelMetricsResponse,
    ParkingCandidate,
    ParkingDecisionRequest,
)


MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "parking_mlp.pt"
METRICS_PATH = Path(__file__).resolve().parents[1] / "models" / "metrics.json"


@dataclass
class ScoredCandidate:
    candidate: ParkingCandidate
    score: float
    eligible: bool


class ParkingDecisionEngine:
    def __init__(
        self,
        model_path: Path = MODEL_PATH,
        metrics_path: Path = METRICS_PATH,
    ) -> None:
        self.model_path = model_path
        self.metrics_path = metrics_path
        self.model_version = "heuristic-fallback"
        self._predict_from_features: Callable[[list[float]], float] | None = None
        self._load_model_if_available()

    @property
    def trained(self) -> bool:
        return self._predict_from_features is not None

    def metrics(self) -> ModelMetricsResponse:
        if self.metrics_path.exists():
            try:
                data = json.loads(self.metrics_path.read_text())
            except (OSError, json.JSONDecodeError):
                data = {}
            if data:
                return ModelMetricsResponse(
                    model_version=self.model_version,
                    trained=self.trained,
                    parking_outcome_score=data.get("parking_outcome_score"),
                    nearest_baseline_score=data.get("nearest_baseline_score"),
                    random_baseline_score=data.get("random_baseline_score"),
                    model_delta_vs_nearest=data.get("model_delta_vs_nearest"),
                    model_delta_vs_random=data.get("model_delta_vs_random"),
                    samples=data.get("samples"),
                )
        return ModelMetricsResponse(model_version=self.model_version, trained=self.trained)

    def score(self, request: ParkingDecisionRequest) -> list[ScoredCandidate]:
        scored = [
            ScoredCandidate(
                candidate=candidate,
                score=self._score_one(request, candidate),
                eligible=is_eligible(candidate),
            )
            for candidate in request.candidates
        ]
        return sorted(scored, key=lambda item: item.score, reverse=True)

    def candidate_scores(self, request: ParkingDecisionRequest) -> list[CandidateScore]:
        ranked = self.score(request)
        return [
            CandidateScore(
                spot_id=item.candidate.id,
                score=item.score,
                eligible=item.eligible,
                rank=index + 1,
            )
            for index, item in enumerate(ranked)
        ]

    def explain(
        self,
        request: ParkingDecisionRequest,
        selected: ParkingCandidate | None,
    ) -> list[ExplanationTerm]:
        if selected is None:
            return []

        base_features = candidate_feature_map(request, selected)
        base_score = self._score_feature_map(request, selected, base_features)
        terms: list[ExplanationTerm] = []

        for feature, value in base_features.items():
            if feature.startswith("weight_"):
                continue
            if feature in {"illegal", "inaccessible"} and value < 0.5:
                continue
            perturbed = dict(base_features)
            perturbed[feature] = min(value * 1.15 + 0.03, 2.0)
            score = self._score_feature_map(request, selected, perturbed)
            impact = round(score - base_score, 4)
            if abs(impact) < 0.01:
                continue
            terms.append(
                ExplanationTerm(
                    feature=feature,
                    impact=impact,
                    direction="helps" if impact > 0 else "hurts",
                    detail=(
                        f"Increasing {feature} changes the predicted utility "
                        f"by {impact:.2f}."
                    ),
                )
            )

        return sorted(terms, key=lambda term: abs(term.impact), reverse=True)[:5]

    def _score_one(
        self,
        request: ParkingDecisionRequest,
        candidate: ParkingCandidate,
    ) -> float:
        if not is_eligible(candidate):
            return INELIGIBLE_SCORE
        if self._predict_from_features is None:
            return score_candidate(request, candidate)
        features = list(candidate_feature_map(request, candidate).values())
        return round(float(self._predict_from_features(features)), 4)

    def _score_feature_map(
        self,
        request: ParkingDecisionRequest,
        candidate: ParkingCandidate,
        features: dict[str, float],
    ) -> float:
        if not is_eligible(candidate):
            return INELIGIBLE_SCORE
        if self._predict_from_features is None:
            return _heuristic_from_features(features)
        return float(
            self._predict_from_features([features[name] for name in FEATURE_NAMES])
        )

    def _load_model_if_available(self) -> None:
        if not self.model_path.exists():
            return
        try:
            import torch

            from backend.ml.model import ParkingMLP
        except Exception:
            return

        try:
            artifact = _load_torch_artifact(torch, self.model_path)
            if not isinstance(artifact, dict):
                return
            architecture = str(artifact.get("architecture", "ParkingMLP"))
            if architecture != "ParkingMLP":
                return
            feature_names = list(artifact.get("feature_names", FEATURE_NAMES))
            if feature_names != FEATURE_NAMES:
                return
            input_dim = int(artifact.get("input_dim", len(feature_names)))
            hidden_dim = int(artifact.get("hidden_dim", 32))
            if input_dim != len(feature_names):
                return
            state_dict = artifact.get("state_dict")
            if state_dict is None:
                return
            scaler = _validate_scaler(artifact.get("scaler"), input_dim)
            model = ParkingMLP(input_dim=input_dim, hidden_dim=hidden_dim)
            model.load_state_dict(state_dict)
            model.eval()
        except Exception:
            return

        self.model_version = str(artifact.get("model_version", "parking-mlp-local"))

        def predict(features: list[float]) -> float:
            scaled_features = _apply_scaler(features, scaler)
            with torch.no_grad():
                tensor = torch.tensor([scaled_features], dtype=torch.float32)
                return float(model(tensor)[0].item())

        self._predict_from_features = predict


def _load_torch_artifact(torch_module: Any, path: Path) -> Any:
    try:
        return torch_module.load(path, map_location="cpu", weights_only=True)
    except TypeError:
        return torch_module.load(path, map_location="cpu")


def _validate_scaler(scaler: Any, input_dim: int) -> dict[str, list[float]] | None:
    if scaler is None:
        return None
    if not isinstance(scaler, dict) or scaler.get("type") != "standard":
        raise ValueError("Unsupported scaler metadata.")
    mean = [float(value) for value in scaler.get("mean", [])]
    scale = [float(value) for value in scaler.get("scale", [])]
    if len(mean) != input_dim or len(scale) != input_dim:
        raise ValueError("Scaler metadata does not match model input dimension.")
    if any(value == 0.0 for value in scale):
        raise ValueError("Scaler metadata contains a zero scale.")
    return {"mean": mean, "scale": scale}


def _apply_scaler(
    features: Sequence[float],
    scaler: dict[str, list[float]] | None,
) -> list[float]:
    if scaler is None:
        return [float(value) for value in features]
    return [
        (float(value) - scaler["mean"][index]) / scaler["scale"][index]
        for index, value in enumerate(features)
    ]


def _heuristic_from_features(features: dict[str, float]) -> float:
    weighted_cost = (
        features["weight_drive_time"] * features["drive_eta_norm"] * 90.0
        + features["weight_walk_distance"] * features["walk_distance_norm"] * 90.0
        + features["weight_price"] * features["price_norm"] * 55.0
        + features["weight_availability_risk"]
        * (features["unavailability"] + features["occupancy_risk"])
        * 65.0
        + features["weight_congestion"]
        * (features["candidate_congestion"] + features["traffic_density"])
        * 50.0
        + features["illegal"] * 500.0
        + features["inaccessible"] * 120.0
    )
    return round(100.0 - weighted_cost, 4)
