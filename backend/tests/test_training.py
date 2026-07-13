from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from backend.app.feature_engineering import FEATURE_NAMES
from backend.app.oracle import INELIGIBLE_SCORE
from backend.ml.dataset_schema import parse_grouped_dataset
from backend.ml.generate_dataset import build_sample
from backend.ml.train import load_dataset


def _features(value: float) -> list[float]:
    return [value] * len(FEATURE_NAMES)


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )


def _grouped_row(index: int, seed: int = 41) -> dict[str, object]:
    return build_sample(random.Random(seed), index=index, seed=seed).model_dump(mode="json")


def test_load_dataset_filters_ineligible_grouped_candidates(tmp_path: Path):
    dataset = tmp_path / "grouped.jsonl"
    row = _grouped_row(index=2)
    _write_jsonl(dataset, [row])

    features, labels = load_dataset(dataset)
    candidate_rows = row["candidate_features"]
    eligible_rows = [
        candidate_row for candidate_row in candidate_rows if candidate_row["eligible"]
    ]

    assert 0 < len(eligible_rows) < len(candidate_rows)
    assert len(features) == len(eligible_rows)
    for actual_features, candidate_row in zip(features.tolist(), eligible_rows):
        assert actual_features == pytest.approx(candidate_row["features"])
    assert labels.tolist() == pytest.approx(
        [candidate_row["label"] for candidate_row in eligible_rows]
    )


def test_parse_grouped_dataset_preserves_sample_groups_and_candidate_order(tmp_path: Path):
    dataset = tmp_path / "grouped.jsonl"
    rows = [_grouped_row(index=1), _grouped_row(index=6)]
    _write_jsonl(dataset, rows)

    records = parse_grouped_dataset(dataset)

    expected_identity = [
        (row["metadata"]["sample_index"], candidate_index, candidate_row["candidate_id"])
        for row in rows
        for candidate_index, candidate_row in enumerate(row["candidate_features"])
    ]
    assert [
        (record.group_id, record.candidate_index, record.candidate_id) for record in records
    ] == expected_identity
    assert [record.features for record in records] == [
        candidate_row["features"]
        for row in rows
        for candidate_row in row["candidate_features"]
    ]
    assert any(record.eligible for record in records)
    assert any(not record.eligible for record in records)


def test_parse_grouped_dataset_rejects_duplicate_group_ids(tmp_path: Path):
    dataset = tmp_path / "duplicate-group.jsonl"
    _write_jsonl(dataset, [_grouped_row(index=0), _grouped_row(index=0, seed=99)])

    with pytest.raises(ValueError, match="Duplicate grouped dataset sample_index: 0"):
        parse_grouped_dataset(dataset)


@pytest.mark.parametrize("invalid_eligibility", [None, "true", 1])
def test_load_dataset_rejects_invalid_grouped_eligibility(
    tmp_path: Path, invalid_eligibility: object
):
    dataset = tmp_path / "invalid-eligibility.jsonl"
    row = _grouped_row(index=0)
    row["candidate_features"][0]["eligible"] = invalid_eligibility
    _write_jsonl(dataset, [row])

    with pytest.raises(ValueError, match="eligible"):
        load_dataset(dataset)


def test_load_dataset_rejects_missing_grouped_eligibility(tmp_path: Path):
    dataset = tmp_path / "missing-eligibility.jsonl"
    row = _grouped_row(index=0)
    del row["candidate_features"][0]["eligible"]
    _write_jsonl(dataset, [row])

    with pytest.raises(ValueError, match="eligible"):
        load_dataset(dataset)


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
    _write_jsonl(dataset, [_grouped_row(index=1)])

    with pytest.raises(ValueError, match="no eligible candidate rows"):
        load_dataset(dataset)
