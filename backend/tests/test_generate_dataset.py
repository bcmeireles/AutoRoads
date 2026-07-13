from __future__ import annotations

import json
import math
import random
import subprocess
import sys
from pathlib import Path

import pytest

from backend.app.feature_engineering import (
    FEATURE_NAMES,
    candidate_feature_map,
    candidate_feature_vector,
)
from backend.app.oracle import INELIGIBLE_SCORE, is_eligible, score_candidate
from backend.app.schemas import ParkingDecisionRequest
from backend.ml.dataset_schema import SyntheticParkingSample
from backend.ml.generate_dataset import SCENARIO_PROFILES, build_sample, generate_dataset


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _read_samples(path: Path) -> list[SyntheticParkingSample]:
    return [SyntheticParkingSample.model_validate(row) for row in _read_jsonl(path)]


def _sample_payload(index: int = 6, seed: int = 73) -> dict[str, object]:
    return build_sample(random.Random(seed), index=index, seed=seed).model_dump(mode="json")


def test_generate_dataset_is_deterministic_with_seed(tmp_path: Path):
    first = tmp_path / "first.jsonl"
    second = tmp_path / "second.jsonl"
    different = tmp_path / "different.jsonl"

    generate_dataset(samples=12, seed=1234, output=first)
    generate_dataset(samples=12, seed=1234, output=second)
    generate_dataset(samples=12, seed=4321, output=different)

    assert first.read_text(encoding="utf-8") == second.read_text(encoding="utf-8")
    assert first.read_text(encoding="utf-8") != different.read_text(encoding="utf-8")


def test_generate_dataset_writes_readable_grouped_jsonl(tmp_path: Path):
    output = tmp_path / "dataset.jsonl"

    generate_dataset(samples=5, seed=44, output=output)
    rows = _read_jsonl(output)

    assert len(rows) == 5
    for index, row in enumerate(rows):
        sample = SyntheticParkingSample.model_validate(row)
        assert sample.metadata.seed == 44
        assert sample.metadata.sample_index == index
        assert 4 <= len(sample.candidates) <= 8
        assert sample.metadata.candidate_ids == [candidate.id for candidate in sample.candidates]
        assert sample.feature_names == FEATURE_NAMES


def test_dataset_feature_ordering_matches_backend_feature_engineering(tmp_path: Path):
    output = tmp_path / "dataset.jsonl"
    generate_dataset(samples=3, seed=7, output=output)

    for sample in _read_samples(output):
        request = sample.as_request()
        assert list(candidate_feature_map(request, sample.candidates[0]).keys()) == FEATURE_NAMES

        for candidate, candidate_row in zip(sample.candidates, sample.candidate_features):
            assert candidate_row.candidate_id == candidate.id
            assert candidate_row.features == candidate_feature_vector(request, candidate)
            assert candidate_row.label == score_candidate(request, candidate)
            assert candidate_row.eligible == is_eligible(candidate)


def test_dataset_values_stay_in_expected_ranges(tmp_path: Path):
    output = tmp_path / "dataset.jsonl"
    generate_dataset(samples=len(SCENARIO_PROFILES), seed=99, output=output)
    samples = _read_samples(output)

    assert {sample.metadata.scenario_profile for sample in samples} == set(SCENARIO_PROFILES)
    for sample in samples:
        weights = sample.weights.normalized()
        weight_total = (
            weights.drive_time
            + weights.walk_distance
            + weights.price
            + weights.availability_risk
            + weights.congestion
        )
        assert math.isclose(weight_total, 1.0)
        assert 0.0 <= sample.city.traffic_density <= 1.0
        assert 0.0 <= sample.city.parking_scarcity <= 1.0
        assert 0.0 <= sample.city.trip_demand <= 1.0

        for candidate in sample.candidates:
            assert candidate.drive_eta_seconds >= 0.0
            assert candidate.walk_distance_meters >= 0.0
            assert candidate.price >= 0.0
            assert 0.0 <= candidate.availability <= 1.0
            assert 0.0 <= candidate.occupancy_risk <= 1.0
            assert 0.0 <= candidate.congestion <= 1.0

        for candidate_row in sample.candidate_features:
            assert len(candidate_row.features) == len(FEATURE_NAMES)
            assert all(math.isfinite(value) for value in candidate_row.features)
            assert all(0.0 <= value <= 2.0 for value in candidate_row.features)


def test_dataset_includes_required_hard_case_profiles(tmp_path: Path):
    output = tmp_path / "dataset.jsonl"
    generate_dataset(samples=len(SCENARIO_PROFILES), seed=11, output=output)
    by_profile = {sample.metadata.scenario_profile: sample for sample in _read_samples(output)}

    assert all(not row.eligible for row in by_profile["full_lots"].candidate_features)
    assert any(not candidate.legal for candidate in by_profile["illegal_spots"].candidates)
    assert any(not candidate.accessible for candidate in by_profile["inaccessible_spots"].candidates)
    assert by_profile["high_congestion"].city.traffic_density >= 0.86
    assert any(candidate.price >= 34.0 for candidate in by_profile["high_price"].candidates)
    assert any(
        candidate.drive_eta_seconds <= 48.0 and candidate.walk_distance_meters >= 850.0
        for candidate in by_profile["far_walk_short_drive"].candidates
    )
    assert any(
        candidate.walk_distance_meters <= 45.0
        and candidate.occupancy_risk >= 0.84
        and candidate.availability <= 0.2
        for candidate in by_profile["short_walk_high_risk"].candidates
    )


def test_dataset_is_compatible_with_parking_decision_request(tmp_path: Path):
    output = tmp_path / "dataset.jsonl"
    generate_dataset(samples=9, seed=23, output=output)

    for sample in _read_samples(output):
        payload = {
            "car": sample.car.model_dump(mode="json"),
            "destination": sample.destination.model_dump(mode="json"),
            "candidates": [candidate.model_dump(mode="json") for candidate in sample.candidates],
            "city": sample.city.model_dump(mode="json"),
            "weights": sample.weights.model_dump(mode="json"),
        }
        request = ParkingDecisionRequest.model_validate(payload)
        scored = [
            (candidate.id, is_eligible(candidate), score_candidate(request, candidate))
            for candidate in request.candidates
        ]
        eligible_scores = [item for item in scored if item[1]]
        expected_selected = (
            max(eligible_scores, key=lambda item: item[2])[0] if eligible_scores else None
        )

        assert request.candidates
        assert sample.oracle_label.selected_candidate_id == expected_selected


@pytest.mark.parametrize(
    ("selected_id", "selected_index"),
    [(None, 0), ("existing", None)],
)
def test_schema_rejects_incomplete_oracle_selection(
    selected_id: str | None, selected_index: int | None
):
    payload = _sample_payload()
    if selected_id == "existing":
        selected_id = payload["candidates"][0]["id"]
    payload["oracle_label"]["selected_candidate_id"] = selected_id
    payload["oracle_label"]["selected_candidate_index"] = selected_index

    with pytest.raises(ValueError, match="ID and index must both be set or both be null"):
        SyntheticParkingSample.model_validate(payload)


def test_schema_rejects_oracle_selection_for_unknown_candidate():
    payload = _sample_payload()
    payload["oracle_label"]["selected_candidate_id"] = "missing-candidate"
    payload["oracle_label"]["selected_candidate_index"] = 0

    with pytest.raises(ValueError, match="must reference a candidate"):
        SyntheticParkingSample.model_validate(payload)


def test_schema_rejects_ineligible_oracle_selection():
    payload = _sample_payload()
    candidate_id = payload["candidates"][0]["id"]
    payload["candidates"][0]["legal"] = False
    payload["candidate_features"][0].update(
        eligible=False,
        label=INELIGIBLE_SCORE,
    )
    payload["oracle_label"]["scores"][0].update(
        eligible=False,
        score=INELIGIBLE_SCORE,
    )
    payload["oracle_label"]["selected_candidate_id"] = candidate_id
    payload["oracle_label"]["selected_candidate_index"] = 0

    with pytest.raises(ValueError, match="selected candidate must be eligible"):
        SyntheticParkingSample.model_validate(payload)


def test_schema_rejects_oracle_selection_below_highest_eligible_score():
    payload = _sample_payload()
    eligible_scores = [
        score for score in payload["oracle_label"]["scores"] if score["eligible"]
    ]
    selected_score = min(eligible_scores, key=lambda score: score["score"])
    selected_index = payload["metadata"]["candidate_ids"].index(
        selected_score["candidate_id"]
    )
    payload["oracle_label"]["selected_candidate_id"] = selected_score["candidate_id"]
    payload["oracle_label"]["selected_candidate_index"] = selected_index

    with pytest.raises(ValueError, match="highest eligible score"):
        SyntheticParkingSample.model_validate(payload)


def test_preview_cli_writes_five_samples(tmp_path: Path):
    output = tmp_path / "preview.jsonl"
    repo_root = Path(__file__).resolve().parents[2]

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.ml.generate_dataset",
            "--preview",
            "--output",
            str(output),
        ],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Wrote 5 preview samples" in result.stdout
    assert len(_read_samples(output)) == 5
