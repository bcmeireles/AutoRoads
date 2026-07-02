from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def _request_payload():
    return {
        "car": {
            "id": "car-1",
            "position": {"x": 0, "z": 0},
            "destination_id": "market",
            "speed_mps": 9,
            "state": "choosing_parking",
        },
        "destination": {
            "id": "market",
            "name": "Market Hall",
            "position": {"x": 40, "z": 20},
            "demand": 0.7,
        },
        "city": {
            "traffic_density": 0.4,
            "parking_scarcity": 0.5,
            "trip_demand": 0.6,
            "signal_delay_seconds": 12,
        },
        "weights": {
            "drive_time": 0.35,
            "walk_distance": 0.25,
            "price": 0.15,
            "availability_risk": 0.15,
            "congestion": 0.1,
        },
        "candidates": [
            {
                "id": "spot-a",
                "position": {"x": 42, "z": 20},
                "drive_eta_seconds": 55,
                "walk_distance_meters": 70,
                "price": 8,
                "availability": 0.25,
                "occupancy_risk": 0.8,
                "congestion": 0.4,
                "legal": True,
                "accessible": True,
            },
            {
                "id": "spot-b",
                "position": {"x": 34, "z": 26},
                "drive_eta_seconds": 80,
                "walk_distance_meters": 140,
                "price": 4,
                "availability": 0.9,
                "occupancy_risk": 0.1,
                "congestion": 0.2,
                "legal": True,
                "accessible": True,
            },
            {
                "id": "spot-c",
                "position": {"x": 20, "z": 12},
                "drive_eta_seconds": 20,
                "walk_distance_meters": 30,
                "price": 0,
                "availability": 1,
                "occupancy_risk": 0,
                "congestion": 0,
                "legal": False,
                "accessible": True,
            },
        ],
    }


def test_health_includes_model_version():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["model_version"]


def test_metrics_endpoint_returns_model_shape():
    response = client.get("/model/metrics")
    assert response.status_code == 200
    assert "trained" in response.json()
    assert "model_version" in response.json()


def test_parking_decision_returns_selection_scores_and_baselines():
    response = client.post("/parking/decide", json=_request_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["selected_spot_id"] == "spot-b"
    assert len(body["candidate_scores"]) == 3
    assert body["candidate_scores"][-1]["spot_id"] == "spot-c"
    assert body["baselines"][0]["strategy"] == "nearest"
    assert body["baselines"][1]["strategy"] == "random"
    assert body["explanation"]


def test_parking_decision_rejects_empty_candidate_list():
    payload = _request_payload()
    payload["candidates"] = []

    response = client.post("/parking/decide", json=payload)

    assert response.status_code == 422


def test_parking_decision_reports_no_selection_when_all_candidates_are_ineligible():
    payload = _request_payload()
    for candidate in payload["candidates"]:
        candidate["legal"] = False

    response = client.post("/parking/decide", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["selected_spot_id"] is None
    assert all(score["eligible"] is False for score in body["candidate_scores"])
    assert all(baseline["spot_id"] is None for baseline in body["baselines"])
    assert body["explanation"] == []


def test_parking_random_baseline_is_deterministic_for_same_request():
    first = client.post("/parking/decide", json=_request_payload())
    second = client.post("/parking/decide", json=_request_payload())

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["baselines"][1] == second.json()["baselines"][1]
