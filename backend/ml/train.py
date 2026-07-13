from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from backend.app.feature_engineering import FEATURE_NAMES
from backend.app.oracle import INELIGIBLE_SCORE
from backend.ml.generate_dataset import DEFAULT_OUTPUT, generate_dataset


MODEL_OUTPUT = Path("backend/models/parking_mlp.pt")
METRICS_OUTPUT = Path("backend/models/metrics.json")
MODEL_VERSION = "parking-mlp-v1"
VALIDATION_FRACTION = 0.2
DEFAULT_GROUP_SIZE = 5
INELIGIBLE_LABEL_THRESHOLD = INELIGIBLE_SCORE / 2.0


@dataclass(frozen=True)
class DatasetRecord:
    row_index: int
    features: list[float]
    label: float
    group_id: str | None
    candidate_id: str
    eligible: bool = True


def load_dataset(path: Path) -> list[DatasetRecord]:
    records: list[DatasetRecord] = []
    with path.open(encoding="utf-8") as handle:
        for row_index, line in enumerate(handle):
            row = json.loads(line)
            row_feature_names = row.get("feature_names")
            if row_feature_names is not None and list(row_feature_names) != FEATURE_NAMES:
                raise ValueError(
                    f"Feature names on row {row_index} do not match backend FEATURE_NAMES."
                )
            if "candidate_features" in row:
                metadata = row.get("metadata")
                if not isinstance(metadata, dict) or "sample_index" not in metadata:
                    raise ValueError(
                        f"Grouped row {row_index} is missing metadata.sample_index."
                    )
                candidate_rows = row["candidate_features"]
                if not isinstance(candidate_rows, list) or not candidate_rows:
                    raise ValueError(
                        f"Grouped row {row_index} has no candidate_features."
                    )
                group_id = str(metadata["sample_index"])
                for candidate_index, candidate_row in enumerate(candidate_rows):
                    if not isinstance(candidate_row, dict):
                        raise ValueError(
                            f"Candidate {candidate_index} on row {row_index} is invalid."
                        )
                    eligible = candidate_row.get("eligible")
                    if type(eligible) is not bool:
                        raise ValueError(
                            f"Candidate {candidate_index} on row {row_index} must declare "
                            "a boolean eligible value."
                        )
                    records.append(
                        _dataset_record(
                            row_index=row_index,
                            features=candidate_row.get("features"),
                            label=candidate_row.get("label"),
                            group_id=group_id,
                            candidate_id=candidate_row.get("candidate_id"),
                            eligible=eligible,
                        )
                    )
                continue

            group_id = row.get("group_id") or row.get("request_id") or row.get(
                "candidate_set_id"
            )
            candidate_id = row.get("candidate_id") or row.get("spot_id") or row.get("id")
            records.append(
                _dataset_record(
                    row_index=row_index,
                    features=row.get("features"),
                    label=row.get("label"),
                    group_id=str(group_id) if group_id is not None else None,
                    candidate_id=candidate_id,
                    eligible=True,
                )
            )
    if not records:
        raise ValueError(f"No training records found in {path}.")
    return records


def _dataset_record(
    *,
    row_index: int,
    features: Any,
    label: Any,
    group_id: str | None,
    candidate_id: Any,
    eligible: bool,
) -> DatasetRecord:
    if not isinstance(features, list):
        raise ValueError(f"Row {row_index} is missing a feature vector.")
    numeric_features = [float(value) for value in features]
    if len(numeric_features) != len(FEATURE_NAMES):
        raise ValueError(
            f"Row {row_index} has {len(numeric_features)} features, "
            f"expected {len(FEATURE_NAMES)}."
        )
    if label is None:
        raise ValueError(f"Row {row_index} is missing a label.")
    return DatasetRecord(
        row_index=row_index,
        features=numeric_features,
        label=float(label),
        group_id=group_id,
        candidate_id=str(candidate_id) if candidate_id is not None else f"row-{row_index}",
        eligible=eligible,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train the AutoRoads parking MLP.")
    parser.add_argument(
        "--dataset",
        "--dataset-path",
        dest="dataset_path",
        type=Path,
        default=DEFAULT_OUTPUT,
    )
    parser.add_argument("--samples", type=int, default=8000)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--hidden-dim", type=int, default=32)
    parser.add_argument(
        "--learning-rate",
        "--lr",
        dest="learning_rate",
        type=float,
        default=0.002,
    )
    parser.add_argument("--model-output", type=Path, default=MODEL_OUTPUT)
    parser.add_argument("--metrics-output", type=Path, default=METRICS_OUTPUT)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--validation-fraction", type=float, default=VALIDATION_FRACTION)
    parser.add_argument("--group-size", type=int, default=DEFAULT_GROUP_SIZE)
    return parser


def main(argv: Sequence[str] | None = None) -> dict[str, Any]:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        import torch
        from torch import nn
        from torch.utils.data import DataLoader, TensorDataset

        from backend.ml.model import ParkingMLP
    except Exception as exc:
        raise SystemExit(
            "PyTorch is required for training. Install with: "
            "python -m pip install -r backend/requirements-ml.txt"
        ) from exc

    if args.samples < 2:
        raise SystemExit("--samples must be at least 2.")
    if args.epochs < 1:
        raise SystemExit("--epochs must be at least 1.")
    if args.hidden_dim < 1:
        raise SystemExit("--hidden-dim must be at least 1.")
    if not 0.0 < args.validation_fraction < 1.0:
        raise SystemExit("--validation-fraction must be greater than 0 and less than 1.")
    if args.group_size < 2:
        raise SystemExit("--group-size must be at least 2.")

    generated_dataset = False
    if not args.dataset_path.exists():
        generate_dataset(samples=args.samples, seed=args.seed, output=args.dataset_path)
        generated_dataset = True

    torch.manual_seed(args.seed)
    records = load_dataset(args.dataset_path)
    train_group_records, validation_records = split_records(
        records,
        seed=args.seed,
        validation_fraction=args.validation_fraction,
    )
    train_records = [
        record for record in train_group_records if _is_trainable_record(record)
    ]
    validation_loss_records = [
        record for record in validation_records if _is_trainable_record(record)
    ]
    if len(train_records) < 2 or not validation_loss_records:
        raise SystemExit(
            "Training requires at least two eligible train rows and one eligible "
            "validation row."
        )

    train_x_raw, train_y = records_to_arrays(train_records)
    validation_x_raw, validation_y = records_to_arrays(validation_loss_records)
    evaluation_x_raw, _evaluation_y = records_to_arrays(validation_records)
    scaler = fit_feature_scaler(train_x_raw)
    train_x = apply_feature_scaler(train_x_raw, scaler)
    validation_x = apply_feature_scaler(validation_x_raw, scaler)
    evaluation_x = apply_feature_scaler(evaluation_x_raw, scaler)

    model = ParkingMLP(input_dim=len(FEATURE_NAMES), hidden_dim=args.hidden_dim)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=0.001,
    )
    loss_fn = nn.MSELoss()
    generator = torch.Generator()
    generator.manual_seed(args.seed)
    loader = DataLoader(
        TensorDataset(torch.from_numpy(train_x), torch.from_numpy(train_y)),
        batch_size=args.batch_size,
        shuffle=True,
        generator=generator,
    )

    history: list[dict[str, float | int]] = []
    validation_tensor = torch.from_numpy(validation_x)
    validation_target = torch.from_numpy(validation_y)
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss_total = 0.0
        train_count = 0
        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            prediction = model(batch_x)
            loss = loss_fn(prediction, batch_y)
            loss.backward()
            optimizer.step()
            train_loss_total += float(loss.item()) * len(batch_x)
            train_count += len(batch_x)

        model.eval()
        with torch.no_grad():
            validation_prediction = model(validation_tensor)
            validation_loss = float(
                loss_fn(validation_prediction, validation_target).item()
            )
        history.append(
            {
                "epoch": epoch,
                "train_loss": train_loss_total / max(train_count, 1),
                "validation_loss": validation_loss,
            }
        )

    model.eval()
    with torch.no_grad():
        validation_predictions = model(validation_tensor).numpy()
        predictions = model(torch.from_numpy(evaluation_x)).numpy()

    rmse = float(math.sqrt(np.mean((validation_predictions - validation_y) ** 2)))
    mae = float(np.mean(np.abs(validation_predictions - validation_y)))
    grouped_metrics = evaluate_grouped_candidates(
        validation_records,
        predictions,
        seed=args.seed,
        group_size=args.group_size,
    )
    final_epoch = history[-1]
    metrics = {
        "model_version": MODEL_VERSION,
        "samples": int(len(records)),
        "eligible_samples": int(
            sum(1 for record in records if _is_trainable_record(record))
        ),
        "train_samples": int(len(train_records)),
        "validation_samples": int(len(validation_loss_records)),
        "validation_candidates": int(len(validation_records)),
        "seed": args.seed,
        "epochs": args.epochs,
        "input_dim": len(FEATURE_NAMES),
        "hidden_dim": args.hidden_dim,
        "learning_rate": args.learning_rate,
        "generated_dataset": generated_dataset,
        "train_loss": round(float(final_epoch["train_loss"]), 6),
        "validation_loss": round(float(final_epoch["validation_loss"]), 6),
        "loss_history": [
            {
                "epoch": int(item["epoch"]),
                "train_loss": round(float(item["train_loss"]), 6),
                "validation_loss": round(float(item["validation_loss"]), 6),
            }
            for item in history
        ],
        "rmse": round(rmse, 4),
        "mae": round(mae, 4),
        **grouped_metrics,
    }

    args.model_output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_version": MODEL_VERSION,
            "architecture": "ParkingMLP",
            "input_dim": len(FEATURE_NAMES),
            "hidden_dim": args.hidden_dim,
            "feature_names": list(FEATURE_NAMES),
            "scaler": scaler,
            "state_dict": model.state_dict(),
        },
        args.model_output,
    )
    args.metrics_output.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_output.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    return metrics


def split_records(
    records: Sequence[DatasetRecord],
    *,
    seed: int,
    validation_fraction: float,
) -> tuple[list[DatasetRecord], list[DatasetRecord]]:
    grouped_records: dict[str, list[DatasetRecord]] = {}
    for record in records:
        split_key = (
            record.group_id if record.group_id is not None else f"row-{record.row_index}"
        )
        grouped_records.setdefault(split_key, []).append(record)

    groups = list(grouped_records.values())
    rng = np.random.default_rng(seed)
    order = np.arange(len(groups))
    rng.shuffle(order)
    shuffled_groups = [groups[index] for index in order]
    validation_group_count = max(
        1,
        int(round(len(shuffled_groups) * validation_fraction)),
    )
    validation_group_count = min(validation_group_count, len(shuffled_groups) - 1)
    validation_groups = shuffled_groups[:validation_group_count]
    train_groups = shuffled_groups[validation_group_count:]
    train_records = [record for group in train_groups for record in group]
    validation_records = [record for group in validation_groups for record in group]
    if not train_records or not validation_records:
        raise SystemExit("Training split requires at least one train and validation row.")
    return train_records, validation_records


def records_to_arrays(records: Sequence[DatasetRecord]) -> tuple[np.ndarray, np.ndarray]:
    features = np.array([record.features for record in records], dtype=np.float32)
    labels = np.array([record.label for record in records], dtype=np.float32)
    return features, labels


def fit_feature_scaler(features: np.ndarray) -> dict[str, Any]:
    mean = features.mean(axis=0)
    scale = features.std(axis=0)
    scale = np.where(scale < 1e-6, 1.0, scale)
    return {
        "type": "standard",
        "mean": mean.astype(float).tolist(),
        "scale": scale.astype(float).tolist(),
    }


def apply_feature_scaler(features: np.ndarray, scaler: dict[str, Any]) -> np.ndarray:
    mean = np.array(scaler["mean"], dtype=np.float32)
    scale = np.array(scaler["scale"], dtype=np.float32)
    return ((features - mean) / scale).astype(np.float32)


def evaluate_grouped_candidates(
    records: Sequence[DatasetRecord],
    predictions: np.ndarray,
    *,
    seed: int,
    group_size: int,
) -> dict[str, Any]:
    groups, source = group_validation_records(records, group_size)
    if not groups:
        return {
            "grouped_candidate_sets": 0,
            "grouped_evaluation_source": source,
            "decision_failures": 0,
            "parking_outcome_score": None,
            "oracle_baseline_score": None,
            "nearest_baseline_score": None,
            "random_baseline_score": None,
            "model_delta_vs_oracle": None,
            "model_delta_vs_nearest": None,
            "model_delta_vs_random": None,
            "model_oracle_pick_rate": None,
            "model_invalid_choice_count": 0,
            "model_invalid_choice_rate": None,
            "average_drive_time_proxy": None,
            "average_walk_distance_proxy": None,
        }

    rng = np.random.default_rng(seed)
    model_scores: list[float] = []
    oracle_scores: list[float] = []
    nearest_scores: list[float] = []
    random_scores: list[float] = []
    drive_time_proxies: list[float] = []
    walk_distance_proxies: list[float] = []
    oracle_matches = 0
    invalid_choices = 0
    decision_failures = 0

    for group in groups:
        eligible_positions = [
            position
            for position, (_index, record) in enumerate(group)
            if record.eligible and _is_trainable_record(record)
        ]
        if not eligible_positions:
            decision_failures += 1
            continue

        group_predictions = np.array([predictions[index] for index, _record in group])
        group_labels = np.array([record.label for _index, record in group])
        model_position = int(np.argmax(group_predictions))
        oracle_position = max(
            eligible_positions,
            key=lambda position: group_labels[position],
        )
        nearest_position = min(
            eligible_positions,
            key=lambda position: _nearest_sort_key(group[position][1].features),
        )
        random_position = eligible_positions[int(rng.integers(0, len(eligible_positions)))]

        model_scores.append(float(group_labels[model_position]))
        oracle_scores.append(float(group_labels[oracle_position]))
        nearest_scores.append(float(group_labels[nearest_position]))
        random_scores.append(float(group_labels[random_position]))
        model_record = group[model_position][1]
        drive_time_proxies.append(
            _feature_value(model_record.features, "drive_eta_norm")
        )
        walk_distance_proxies.append(
            _feature_value(model_record.features, "walk_distance_norm")
        )
        if model_position not in eligible_positions:
            invalid_choices += 1
        if model_position == oracle_position:
            oracle_matches += 1

    if not model_scores:
        return {
            "grouped_candidate_sets": len(groups),
            "grouped_evaluation_source": source,
            "decision_failures": decision_failures,
            "parking_outcome_score": None,
            "oracle_baseline_score": None,
            "nearest_baseline_score": None,
            "random_baseline_score": None,
            "model_delta_vs_oracle": None,
            "model_delta_vs_nearest": None,
            "model_delta_vs_random": None,
            "model_oracle_pick_rate": None,
            "model_invalid_choice_count": 0,
            "model_invalid_choice_rate": None,
            "average_drive_time_proxy": None,
            "average_walk_distance_proxy": None,
        }

    model_score = float(np.mean(model_scores))
    oracle_score = float(np.mean(oracle_scores))
    nearest_score = float(np.mean(nearest_scores))
    random_score = float(np.mean(random_scores))
    return {
        "grouped_candidate_sets": len(groups),
        "grouped_evaluation_source": source,
        "decision_failures": decision_failures,
        "parking_outcome_score": round(model_score, 4),
        "oracle_baseline_score": round(oracle_score, 4),
        "nearest_baseline_score": round(nearest_score, 4),
        "random_baseline_score": round(random_score, 4),
        "model_delta_vs_oracle": round(model_score - oracle_score, 4),
        "model_delta_vs_nearest": round(model_score - nearest_score, 4),
        "model_delta_vs_random": round(model_score - random_score, 4),
        "model_oracle_pick_rate": round(oracle_matches / len(model_scores), 4),
        "model_invalid_choice_count": invalid_choices,
        "model_invalid_choice_rate": round(invalid_choices / len(model_scores), 4),
        "average_drive_time_proxy": round(float(np.mean(drive_time_proxies)), 4),
        "average_walk_distance_proxy": round(
            float(np.mean(walk_distance_proxies)),
            4,
        ),
    }


def group_validation_records(
    records: Sequence[DatasetRecord],
    group_size: int,
) -> tuple[list[list[tuple[int, DatasetRecord]]], str]:
    explicit_groups: defaultdict[str, list[tuple[int, DatasetRecord]]] = defaultdict(list)
    for index, record in enumerate(records):
        if record.group_id is not None:
            explicit_groups[record.group_id].append((index, record))

    dataset_groups = [group for group in explicit_groups.values() if len(group) > 1]
    if dataset_groups:
        return dataset_groups, "dataset_groups"

    chunks: list[list[tuple[int, DatasetRecord]]] = []
    indexed_records = list(enumerate(records))
    for start in range(0, len(indexed_records), group_size):
        chunk = indexed_records[start : start + group_size]
        if len(chunk) > 1:
            chunks.append(chunk)
    return chunks, "deterministic_flat_chunks"


def _nearest_sort_key(features: Sequence[float]) -> tuple[float, float, float]:
    feature_map = dict(zip(FEATURE_NAMES, features))
    return (
        feature_map["walk_distance_norm"],
        feature_map["drive_eta_norm"],
        feature_map["price_norm"],
    )


def _feature_value(features: Sequence[float], name: str) -> float:
    return float(features[FEATURE_NAMES.index(name)])


def _is_trainable_record(record: DatasetRecord) -> bool:
    if not record.eligible or record.label <= INELIGIBLE_LABEL_THRESHOLD:
        return False
    feature_map = dict(zip(FEATURE_NAMES, record.features))
    return (
        feature_map["illegal"] < 0.5
        and feature_map["inaccessible"] < 0.5
        and feature_map["unavailability"] < 0.95
    )


if __name__ == "__main__":
    main()
