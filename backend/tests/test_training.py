from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.feature_engineering import FEATURE_NAMES
from backend.app.oracle import INELIGIBLE_SCORE
from backend.ml.train import load_dataset


def _features(value: float) -> list[float]:
    return [value] * len(FEATURE_NAMES)


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )


def test_load_dataset_filters_ineligible_grouped_candidates(tmp_path: Path):
    dataset = tmp_path / "grouped.jsonl"
    _write_jsonl(
        dataset,
        [
            {
                "candidate_features": [
                    {
                        "candidate_id": "eligible-1",
                        "features": _features(0.125),
                        "label": 72.5,
                        "eligible": True,
                    },
                    {
                        "candidate_id": "ineligible",
                        "features": _features(0.25),
                        "label": INELIGIBLE_SCORE,
                        "eligible": False,
                    },
                    {
                        "candidate_id": "eligible-2",
                        "features": _features(0.5),
                        "label": 81.25,
                        "eligible": True,
                    },
                ],
            }
        ],
    )

    features, labels = load_dataset(dataset)

    assert features.tolist() == [_features(0.125), _features(0.5)]
    assert labels.tolist() == [72.5, 81.25]


def test_load_dataset_preserves_legacy_flat_rows(tmp_path: Path):
    dataset = tmp_path / "legacy.jsonl"
    _write_jsonl(
        dataset,
        [
            {"features": _features(0.25), "label": INELIGIBLE_SCORE},
            {"features": _features(0.5), "label": 64.0},
        ],
    )

    features, labels = load_dataset(dataset)

    assert features.tolist() == [_features(0.25), _features(0.5)]
    assert labels.tolist() == [INELIGIBLE_SCORE, 64.0]


def test_load_dataset_rejects_all_ineligible_grouped_dataset(tmp_path: Path):
    dataset = tmp_path / "all-ineligible.jsonl"
    _write_jsonl(
        dataset,
        [
            {
                "candidate_features": [
                    {
                        "candidate_id": "ineligible-1",
                        "features": _features(0.25),
                        "label": INELIGIBLE_SCORE,
                        "eligible": False,
                    },
                    {
                        "candidate_id": "ineligible-2",
                        "features": _features(0.5),
                        "label": INELIGIBLE_SCORE,
                        "eligible": False,
                    },
                ],
            }
        ],
    )

    with pytest.raises(ValueError, match="no eligible candidate rows"):
        load_dataset(dataset)
