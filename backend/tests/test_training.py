import json
from pathlib import Path

import numpy as np
import pytest

from backend.app.feature_engineering import FEATURE_NAMES
from backend.app.model import ParkingDecisionEngine
from backend.ml.train import DatasetRecord, evaluate_grouped_candidates, load_dataset


def _features(
    *,
    walk_distance_norm: float,
    drive_eta_norm: float = 0.2,
    price_norm: float = 0.2,
) -> list[float]:
    values = dict.fromkeys(FEATURE_NAMES, 0.0)
    values["walk_distance_norm"] = walk_distance_norm
    values["drive_eta_norm"] = drive_eta_norm
    values["price_norm"] = price_norm
    return [values[name] for name in FEATURE_NAMES]


def test_model_loader_falls_back_when_artifact_is_missing(tmp_path: Path):
    engine = ParkingDecisionEngine(
        model_path=tmp_path / "missing.pt",
        metrics_path=tmp_path / "missing.json",
    )

    assert engine.trained is False
    assert engine.model_version == "heuristic-fallback"
    assert engine.metrics().trained is False


def test_grouped_evaluation_compares_model_oracle_nearest_and_random():
    records = [
        DatasetRecord(0, _features(walk_distance_norm=0.6), 8.0, "group-a", "a"),
        DatasetRecord(1, _features(walk_distance_norm=0.1), 10.0, "group-a", "b"),
        DatasetRecord(2, _features(walk_distance_norm=0.2), 4.0, "group-b", "c"),
        DatasetRecord(3, _features(walk_distance_norm=0.5), 5.0, "group-b", "d"),
    ]
    predictions = np.array([0.9, 0.1, 0.2, 0.8], dtype=np.float32)

    metrics = evaluate_grouped_candidates(
        records,
        predictions,
        seed=7,
        group_size=3,
    )

    assert metrics["grouped_evaluation_source"] == "dataset_groups"
    assert metrics["grouped_candidate_sets"] == 2
    assert metrics["parking_outcome_score"] == 6.5
    assert metrics["oracle_baseline_score"] == 7.5
    assert metrics["nearest_baseline_score"] == 7.0
    assert metrics["model_delta_vs_oracle"] == -1.0
    assert "model_delta_vs_random" in metrics


def test_load_dataset_reads_grouped_candidates_and_preserves_group_id(tmp_path: Path):
    dataset_path = tmp_path / "grouped.jsonl"
    dataset_path.write_text(
        json.dumps(
            {
                "metadata": {"sample_index": 7},
                "feature_names": FEATURE_NAMES,
                "candidate_features": [
                    {
                        "candidate_id": "p1",
                        "features": _features(walk_distance_norm=0.1),
                        "label": 10.0,
                        "eligible": True,
                    },
                    {
                        "candidate_id": "p2",
                        "features": _features(walk_distance_norm=0.8),
                        "label": -1_000_000.0,
                        "eligible": False,
                    },
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    records = load_dataset(dataset_path)

    assert [record.group_id for record in records] == ["7", "7"]
    assert [record.candidate_id for record in records] == ["p1", "p2"]
    assert [record.eligible for record in records] == [True, False]


@pytest.mark.parametrize("eligible", [None, "true", 1])
def test_load_dataset_rejects_invalid_grouped_eligibility(
    tmp_path: Path,
    eligible: object,
):
    dataset_path = tmp_path / "invalid.jsonl"
    candidate = {
        "candidate_id": "p1",
        "features": _features(walk_distance_norm=0.1),
        "label": 10.0,
    }
    if eligible is not None:
        candidate["eligible"] = eligible
    dataset_path.write_text(
        json.dumps(
            {
                "metadata": {"sample_index": 0},
                "feature_names": FEATURE_NAMES,
                "candidate_features": [candidate],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="boolean eligible"):
        load_dataset(dataset_path)


def test_grouped_evaluation_reports_invalid_choices_and_proxies():
    records = [
        DatasetRecord(0, _features(walk_distance_norm=0.1), 10.0, "group-a", "a"),
        DatasetRecord(0, _features(walk_distance_norm=0.4), 8.0, "group-a", "b"),
        DatasetRecord(
            0,
            _features(walk_distance_norm=0.9, drive_eta_norm=0.8),
            -1_000_000.0,
            "group-a",
            "c",
            False,
        ),
    ]

    metrics = evaluate_grouped_candidates(
        records,
        np.array([0.1, 0.2, 99.0], dtype=np.float32),
        seed=5,
        group_size=3,
    )

    assert metrics["model_invalid_choice_count"] == 1
    assert metrics["model_invalid_choice_rate"] == 1.0
    assert metrics["decision_failures"] == 0
    assert metrics["average_drive_time_proxy"] == 0.8
    assert metrics["average_walk_distance_proxy"] == 0.9


def test_training_cli_writes_loadable_backend_artifact(tmp_path: Path):
    torch = pytest.importorskip("torch")
    from backend.ml.train import main

    dataset_path = tmp_path / "synthetic.jsonl"
    model_path = tmp_path / "parking_mlp.pt"
    metrics_path = tmp_path / "metrics.json"

    main(
        [
            "--dataset-path",
            str(dataset_path),
            "--samples",
            "120",
            "--seed",
            "11",
            "--epochs",
            "1",
            "--hidden-dim",
            "8",
            "--learning-rate",
            "0.005",
            "--model-output",
            str(model_path),
            "--metrics-output",
            str(metrics_path),
        ]
    )

    assert model_path.exists()
    assert metrics_path.exists()
    metrics = json.loads(metrics_path.read_text())
    assert metrics["train_loss"] >= 0
    assert metrics["validation_loss"] >= 0
    assert metrics["mae"] >= 0
    assert metrics["grouped_candidate_sets"] > 0
    assert metrics["grouped_evaluation_source"] == "deterministic_flat_chunks"

    artifact = torch.load(model_path, map_location="cpu", weights_only=True)
    assert artifact["model_version"] == "parking-mlp-v1"
    assert artifact["architecture"] == "ParkingMLP"
    assert artifact["feature_names"] == FEATURE_NAMES
    assert artifact["input_dim"] == len(FEATURE_NAMES)
    assert artifact["hidden_dim"] == 8
    assert "state_dict" in artifact
    assert artifact["scaler"]["type"] == "standard"

    engine = ParkingDecisionEngine(model_path=model_path, metrics_path=metrics_path)
    assert engine.trained is True
    assert engine.model_version == "parking-mlp-v1"
    assert engine.metrics().samples == metrics["samples"]
