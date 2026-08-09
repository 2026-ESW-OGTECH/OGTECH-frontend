"""로컬 GNSS API와 지도 경로 연계 통합 테스트."""

from __future__ import annotations

from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from app import build_server


class GpsApiIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.server = build_server(
            "127.0.0.1",
            0,
            gps_configuration={"mode": "replay"},
            waypoint_path=Path(self.temporary.name) / "waypoints.json",
        )
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2.0)
        self.temporary.cleanup()

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
    ) -> tuple[int, dict[str, object]]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {} if body is None else {"Content-Type": "application/json"}
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5.0)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read().decode("utf-8"))
        finally:
            connection.close()

    def test_replay_fix_routes_without_masquerading_as_live_sensor(self) -> None:
        status, error = self.request(
            "POST",
            "/api/gps/configure",
            {"mode": "air530", "port": "/dev/null", "baud": "invalid"},
        )
        self.assertEqual(status, 422)
        self.assertIn("baud", str(error["error"]))

        deadline = time.monotonic() + 2.0
        gps: dict[str, object] = {}
        while time.monotonic() < deadline:
            status, gps = self.request("GET", "/api/gps")
            if gps.get("fix") is True:
                break
            time.sleep(0.02)
        self.assertEqual(status, 200)
        self.assertTrue(gps["fix"])
        self.assertTrue(gps["demo"])

        _, map_overview = self.request("GET", "/api/map")
        points = map_overview["suggested_points"]
        assert isinstance(points, dict)
        destination = points["destination"]
        status, route = self.request(
            "POST",
            "/api/route",
            {
                "current": {"lat": gps["lat"], "lon": gps["lon"]},
                "destination": destination,
                "accuracy_m": gps.get("acc_m"),
                "satellites": gps.get("satellites", 0),
                "age_s": gps.get("age_s", 0),
                "source": "demo",
                "fix": True,
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(route["contract"]["map_and_route_computed_by_code"])
        self.assertFalse(route["device_state"]["gps"]["fix"])
        self.assertTrue(route["demo"])

        status, stopped = self.request("POST", "/api/gps/stop", {})
        self.assertEqual(status, 200)
        self.assertEqual(stopped["mode"], "off")
        self.assertFalse(stopped["fix"])

    def test_product_screen_and_waypoint_api_use_integrated_device_state(self) -> None:
        deadline = time.monotonic() + 2.0
        device: dict[str, object] = {}
        while time.monotonic() < deadline:
            status, device = self.request("GET", "/api/device")
            gps = device.get("gps")
            if isinstance(gps, dict) and gps.get("fix") is True:
                break
            time.sleep(0.02)
        self.assertEqual(status, 200)
        self.assertIn("environment", device)
        self.assertIn("sun", device)
        self.assertIn("navigation", device)
        self.assertTrue(device["demo"])

        status, saved = self.request(
            "POST",
            "/api/waypoints",
            {"action": "save_current", "kind": "basecamp"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(saved["waypoints"]["selected_target"], "basecamp")
        self.assertTrue(saved["contract"]["map_route_bearing_distance_computed_by_code"])
        self.assertFalse(saved["contract"]["llm_may_generate_coordinates"])

        connection = HTTPConnection("127.0.0.1", self.port, timeout=5.0)
        try:
            connection.request("GET", "/product/")
            response = connection.getresponse()
            html = response.read().decode("utf-8")
        finally:
            connection.close()
        self.assertEqual(response.status, 200)
        self.assertIn("ENVIRONMENT", html)
        self.assertNotIn("demo-badge", html)
        self.assertIn("live_app.js", html)

    def test_video_screen_is_explicit_demo_and_uses_konkuk_pois(self) -> None:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5.0)
        try:
            connection.request("GET", "/video/")
            response = connection.getresponse()
            html = response.read().decode("utf-8")
        finally:
            connection.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(html.count("DEMO"), 1)
        self.assertIn("video_app.js", html)
        self.assertIn("공학관", html)
        self.assertIn("일감호", html)
        self.assertIn("SEOUL TIME", html)
        self.assertIn("30.0°", html)
        self.assertIn("55% RH", html)
        self.assertIn("btnCheckpoint", html)
        self.assertIn("btnBasecamp", html)
        self.assertIn("btnNight", html)
        self.assertIn("arrivalCard", html)
        self.assertIn("목적지에 도착하였습니다.", html)
        self.assertIn("destination_arrived.wav", html)
        self.assertIn("daylight_detail.wav", html)
        self.assertNotIn("dialogueCard", html)
        self.assertNotIn("나 목마른데 물 마실 곳 찾아줘", html)

        connection = HTTPConnection("127.0.0.1", self.port, timeout=5.0)
        try:
            connection.request("GET", "/video/video_app.js")
            response = connection.getresponse()
            video_app = response.read().decode("utf-8")
        finally:
            connection.close()
        self.assertEqual(response.status, 200)
        self.assertIn('timeZone: "Asia/Seoul"', video_app)
        self.assertIn('second: "2-digit"', video_app)
        self.assertIn("speedMps: 4.0", video_app)
        self.assertIn("function saveCheckpoint()", video_app)
        self.assertIn("function showBasecampRoute()", video_app)
        self.assertIn("function routeOnTrails(", video_app)
        self.assertIn("function selectMapDestination(", video_app)
        self.assertIn('canvas.addEventListener("click", selectMapDestination)', video_app)
        self.assertIn('playFixedAudio("arrival")', video_app)
        self.assertIn("베이스캠프가 등록되었습니다.", video_app)
        self.assertIn("베이스캠프 복귀 경로가 설정되었습니다.", video_app)
        self.assertIn("야간 모드가 활성화되었습니다.", video_app)
        self.assertIn("현재 위치 기준으로 약 한 시간 뒤에 해가 집니다.", video_app)
        self.assertIn("해가 지기까지 1시간 남았습니다. base캠프로 돌아가세요.", video_app)
        self.assertIn('const VIDEO_SUNRISE = "05:34"', video_app)
        self.assertIn("function formatDaylightRemaining(minutes)", video_app)
        self.assertNotIn("일감호 경로 이동 재생", video_app)
        self.assertNotIn("BASE CAMP 복귀 경로 재생", video_app)

        for audio_name in (
            "destination_set.wav",
            "destination_arrived.wav",
            "return_to_base.wav",
            "daylight_detail.wav",
        ):
            connection = HTTPConnection("127.0.0.1", self.port, timeout=5.0)
            try:
                connection.request("GET", f"/video/{audio_name}")
                response = connection.getresponse()
                audio = response.read()
            finally:
                connection.close()
            self.assertEqual(response.status, 200)
            self.assertGreater(len(audio), 1_000)
            self.assertEqual(audio[:4], b"RIFF")

        connection = HTTPConnection("127.0.0.1", self.port, timeout=5.0)
        try:
            connection.request("GET", "/video/video_map.js")
            response = connection.getresponse()
            map_data = response.read().decode("utf-8")
        finally:
            connection.close()
        self.assertEqual(response.status, 200)
        self.assertIn("relation/7885627", map_data)
        self.assertIn("way/369210727", map_data)
        self.assertIn("map_engine.find_route (A*)", map_data)


if __name__ == "__main__":
    unittest.main()
