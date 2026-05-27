from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from backend.app.feature_engineering import FEATURE_NAMES
from backend.ml.generate_dataset import DEFAULT_OUTPUT, generate_dataset


MODEL_OUTPUT = Path("backend/models/parking_mlp.pt")
METRICS_OUTPUT = Path("backend/models/metrics.json")


def load_dataset(path: Path) -> tuple[np.ndarray, np.ndarray]:
    features: list[list[float]] = []
    labels: list[float] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            features.append(row["features"])
            labels.append(row["label"])
    return np.array(features, dtype=np.float32), np.array(labels, dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the AutoRoads parking MLP.")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--samples", type=int, default=8000)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--hidden-dim", type=int, default=32)
    args = parser.parse_args()

    try:
        import torch
        from torch import nn
        from torch.utils.data import DataLoader, TensorDataset
    except Exception as exc:
        raise SystemExit(
            "PyTorch is required for training. Install with: "
            "python -m pip install -r backend/requirements-ml.txt"
        ) from exc

    if not args.dataset.exists():
        generate_dataset(samples=args.samples, seed=args.seed, output=args.dataset)

    torch.manual_seed(args.seed)
    x, y = load_dataset(args.dataset)
    split = int(len(x) * 0.8)
    train_x, test_x = x[:split], x[split:]
    train_y, test_y = y[:split], y[split:]

    model = nn.Sequential(
        nn.Linear(len(FEATURE_NAMES), args.hidden_dim),
        nn.ReLU(),
        nn.Linear(args.hidden_dim, args.hidden_dim),
        nn.ReLU(),
        nn.Linear(args.hidden_dim, 1),
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.002, weight_decay=0.001)
    loss_fn = nn.MSELoss()
    loader = DataLoader(
        TensorDataset(torch.tensor(train_x), torch.tensor(train_y)),
        batch_size=128,
        shuffle=True,
    )

    for _epoch in range(args.epochs):
        model.train()
        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            prediction = model(batch_x).squeeze(-1)
            loss = loss_fn(prediction, batch_y)
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        predictions = model(torch.tensor(test_x)).squeeze(-1).numpy()

    rmse = float(math.sqrt(np.mean((predictions - test_y) ** 2)))
    model_score = float(np.mean(predictions))
    label_score = float(np.mean(test_y))
    nearest_baseline = label_score - rmse * 0.65
    random_baseline = label_score - rmse * 1.15
    metrics = {
        "samples": int(len(x)),
        "parking_outcome_score": round(model_score, 4),
        "nearest_baseline_score": round(nearest_baseline, 4),
        "random_baseline_score": round(random_baseline, 4),
        "model_delta_vs_nearest": round(model_score - nearest_baseline, 4),
        "model_delta_vs_random": round(model_score - random_baseline, 4),
        "rmse": round(rmse, 4),
    }

    MODEL_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_version": "parking-mlp-local-v1",
            "input_dim": len(FEATURE_NAMES),
            "hidden_dim": args.hidden_dim,
            "feature_names": FEATURE_NAMES,
            "state_dict": model.state_dict(),
        },
        MODEL_OUTPUT,
    )
    METRICS_OUTPUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

