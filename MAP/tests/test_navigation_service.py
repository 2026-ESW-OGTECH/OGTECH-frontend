"""저장 지점·경로·귀환 시각 조립 계약 테스트."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from gps_service import GpsService, encode_stm32_telemetry
from navigation_service import NavigationInputError, NavigationService


ROOT = Path(__file__).resolve().parents[1]
NMEA_REPLAY = ROOT / "sample_data" / "air530_replay.nmea"


class FakeRoute:
    coordinates = (
        (127.0757, 37.5465),
        (127.0758, 37.5466),
        (127.0760, 37.5470),
    )
    distance_m = 480.0


class FakeRegistry:
    def overview(self) -> dict[str, object]:
        return {"name": "테스트 보행 지도", "source_name": "test.graphml", "demo": False}

    def trail_offset_m(self, lat: float, lon: float) -> float:
        return 8.0

    def route_between(
        self,
        start_lat: float,
        start_lon: float,
        goal_lat: float,
        goal_lon: float,
    ) -> FakeRoute:
        return FakeRoute()


class NavigationServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.gps = GpsService(NMEA_REPLAY)
        self.gps._handle_line(
            '{"ok":true,"event":"fix","lat":37.5465,"lon":127.0757,'
            '"acc_m":5.0,"sats":9,"age_s":0}',
            mode="stm32",
        )
        self.service = NavigationService(
            FakeRegistry(),
            self.gps,
            Path(self.temporary.name) / "waypoints.json",
            local_tz=timezone(timedelta(hours=9)),
        )

    def tearDown(self) -> None:
        self.gps.close()
        self.temporary.cleanup()

    def test_basecamp_save_enables_code_computed_return_time(self) -> None:
        result = self.service.apply_waypoint({"action": "save_current", "kind": "basecamp"})
        result = self.service.snapshot(
            now=datetime(2026, 8, 9, 12, 0, tzinfo=timezone(timedelta(hours=9)))
        )

        self.assertEqual(result["waypoints"]["selected_target"], "basecamp")
        self.assertTrue(result["navigation"]["active_route"]["available"])
        self.assertEqual(result["navigation"]["active_route"]["computed_by"], "map_engine")
        self.assertEqual(result["sun"]["travel_min"], 10)
        self.assertEqual(result["sun"]["margin_min"], 30)
        self.assertEqual(result["sun"]["status"], "scheduled")
        self.assertTrue(result["contract"]["llm_may_generate_coordinates"] is False)

    def test_no_fix_cannot_be_saved_as_current_position(self) -> None:
        empty_gps = GpsService(NMEA_REPLAY)
        try:
            service = NavigationService(
                FakeRegistry(),
                empty_gps,
                Path(self.temporary.name) / "empty.json",
                local_tz=timezone.utc,
            )
            with self.assertRaisesRegex(NavigationInputError, "GPS fix"):
                service.apply_waypoint({"action": "save_current", "kind": "checkpoint"})
        finally:
            empty_gps.close()

    def test_co_alarm_has_priority_and_requests_sound(self) -> None:
        payload = {
            "v": 1,
            "event": "telemetry",
            "seq": 1,
            "uptime_ms": 400000,
            "gps": {
                "fix": True,
                "lat": 37.5465,
                "lon": 127.0757,
                "acc_m": 5.0,
                "hdop": 0.8,
                "sats": 10,
                "age_s": 0,
            },
            "env": {"valid": True, "temp_c": 22.0, "humidity_pct": 50.0, "age_s": 0},
            "co": {
                "valid": True,
                "warming_up": False,
                "ppm": 112.0,
                "level": "alarm",
                "alarm": True,
                "age_s": 0,
            },
            "power": {"valid": False, "percent": None, "days_left": None},
        }
        self.gps._handle_line(encode_stm32_telemetry(payload), mode="stm32")

        result = self.service.snapshot()

        self.assertEqual(result["alert"]["kind"], "co_alarm")
        self.assertTrue(result["alert"]["sound"])
        self.assertIn("112 ppm", result["alert"]["text"])


if __name__ == "__main__":
    unittest.main()
