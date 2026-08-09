"""센서 상태, 오프라인 지도, 일출몰, 저장 지점을 하나의 안전한 화면 상태로 조립한다."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone, tzinfo
import json
from math import atan2, ceil, degrees, floor, radians, sin, cos
import os
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

from gps_service import GpsInputError, GpsService
from map_engine import MapValidationError, RouteNotFound, SnapOutOfBounds, haversine_m
from solar_service import calculate_solar_times, clock_or_none, configured_timezone, iso_or_none


WAYPOINT_SCHEMA_VERSION = 1
WAYPOINT_KINDS = {"basecamp", "destination", "checkpoint"}
TRAIL_THRESHOLD_M = float(os.getenv("SAFEAID_TRAIL_THRESHOLD_M", "30"))
RETURN_SPEED_MPS = float(os.getenv("SAFEAID_RETURN_SPEED_MPS", "0.8"))
RETURN_MARGIN_MIN = int(os.getenv("SAFEAID_RETURN_MARGIN_MIN", "30"))


class NavigationInputError(ValueError):
    """저장 지점 또는 항법 요청이 계약을 만족하지 않을 때 발생한다."""


def _coordinate(value: Any, label: str, lower: float, upper: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise NavigationInputError(f"{label} 값이 숫자가 아닙니다") from exc
    if not lower <= number <= upper:
        raise NavigationInputError(f"{label} 값이 허용 범위를 벗어났습니다")
    return number


def _bearing_degrees(start: dict[str, Any], target: dict[str, Any]) -> float:
    start_lat = radians(float(start["lat"]))
    target_lat = radians(float(target["lat"]))
    delta_lon = radians(float(target["lon"]) - float(start["lon"]))
    y = sin(delta_lon) * cos(target_lat)
    x = cos(start_lat) * sin(target_lat) - sin(start_lat) * cos(target_lat) * cos(delta_lon)
    return (degrees(atan2(y, x)) + 360.0) % 360.0


class WaypointStore:
    """LLM 도구와 화면이 함께 쓸 수 있는 명시적 저장 지점 계약."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._load_error: str | None = None
        self._state = self._load()

    @staticmethod
    def _empty() -> dict[str, Any]:
        return {
            "version": WAYPOINT_SCHEMA_VERSION,
            "basecamp": None,
            "destination": None,
            "checkpoints": [],
            "selected_target": None,
        }

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return self._empty()
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or payload.get("version") != WAYPOINT_SCHEMA_VERSION:
                raise NavigationInputError("저장 지점 스키마 버전이 올바르지 않습니다")
            result = self._empty()
            for kind in ("basecamp", "destination"):
                value = payload.get(kind)
                result[kind] = None if value is None else self._validate_point(value, kind)
            checkpoints = payload.get("checkpoints", [])
            if not isinstance(checkpoints, list):
                raise NavigationInputError("체크포인트 목록이 배열이 아닙니다")
            result["checkpoints"] = [self._validate_point(item, "checkpoint") for item in checkpoints]
            selected = payload.get("selected_target")
            if selected is not None and not isinstance(selected, str):
                raise NavigationInputError("선택 지점 ID가 문자열이 아닙니다")
            result["selected_target"] = selected
            return result
        except (OSError, json.JSONDecodeError, NavigationInputError) as exc:
            self._load_error = str(exc)
            return self._empty()

    @staticmethod
    def _validate_point(value: Any, kind: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise NavigationInputError("저장 지점이 객체가 아닙니다")
        return {
            "id": str(value.get("id") or kind),
            "kind": kind,
            "name": str(value.get("name") or ("베이스캠프" if kind == "basecamp" else "목적지" if kind == "destination" else "체크포인트"))[:40],
            "lat": _coordinate(value.get("lat"), "저장 지점 위도", -90, 90),
            "lon": _coordinate(value.get("lon"), "저장 지점 경도", -180, 180),
            "source": str(value.get("source") or "user")[:20],
            "saved_at": str(value.get("saved_at") or ""),
        }

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f"{self.path.name}.{uuid4().hex}.tmp")
        temporary.write_text(
            json.dumps(self._state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(self.path)
        self._load_error = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            result = json.loads(json.dumps(self._state, ensure_ascii=False))
            result["load_error"] = self._load_error
            return result

    def _point_by_id(self, identifier: str) -> dict[str, Any] | None:
        if identifier in {"basecamp", "destination"}:
            return self._state.get(identifier)
        return next(
            (item for item in self._state["checkpoints"] if item["id"] == identifier),
            None,
        )

    def selected_point(self) -> dict[str, Any] | None:
        with self._lock:
            selected = self._state.get("selected_target")
            return None if not selected else self._point_by_id(selected)

    def apply(self, payload: dict[str, Any], gps: dict[str, Any]) -> dict[str, Any]:
        action = str(payload.get("action", "")).strip()
        kind = str(payload.get("kind", "")).strip()
        if action not in {"save_current", "set", "select", "remove"}:
            raise NavigationInputError("지원하지 않는 저장 지점 동작입니다")

        with self._lock:
            if action in {"save_current", "set"}:
                if kind not in WAYPOINT_KINDS:
                    raise NavigationInputError("kind는 basecamp, destination, checkpoint 중 하나여야 합니다")
                if action == "save_current":
                    if gps.get("fix") is not True:
                        raise NavigationInputError("현재 GPS fix가 없어 지점을 저장할 수 없습니다")
                    lat = _coordinate(gps.get("lat"), "현재 위도", -90, 90)
                    lon = _coordinate(gps.get("lon"), "현재 경도", -180, 180)
                    source = "sensor" if not gps.get("demo") else "replay"
                else:
                    lat = _coordinate(payload.get("lat"), "지정 위도", -90, 90)
                    lon = _coordinate(payload.get("lon"), "지정 경도", -180, 180)
                    source = "user"
                default_name = "베이스캠프" if kind == "basecamp" else "목적지" if kind == "destination" else "체크포인트"
                point = {
                    "id": kind if kind != "checkpoint" else f"checkpoint-{uuid4().hex[:10]}",
                    "kind": kind,
                    "name": str(payload.get("name") or default_name)[:40],
                    "lat": lat,
                    "lon": lon,
                    "source": source,
                    "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                }
                if kind == "checkpoint":
                    self._state["checkpoints"].append(point)
                    self._state["checkpoints"] = self._state["checkpoints"][-50:]
                else:
                    self._state[kind] = point
                self._state["selected_target"] = point["id"]

            elif action == "select":
                identifier = str(payload.get("id") or kind).strip()
                if not identifier or self._point_by_id(identifier) is None:
                    raise NavigationInputError("선택할 저장 지점이 없습니다")
                self._state["selected_target"] = identifier

            elif action == "remove":
                identifier = str(payload.get("id") or kind).strip()
                if identifier in {"basecamp", "destination"}:
                    self._state[identifier] = None
                else:
                    self._state["checkpoints"] = [
                        item for item in self._state["checkpoints"] if item["id"] != identifier
                    ]
                if self._state.get("selected_target") == identifier:
                    self._state["selected_target"] = None
            self._write()
            return self.snapshot()


class NavigationService:
    """LLM을 거치지 않고 모든 위치·경로·귀환 시각을 코드로 계산한다."""

    def __init__(
        self,
        registry: Any,
        gps: GpsService,
        waypoint_path: str | Path,
        *,
        local_tz: tzinfo | None = None,
    ) -> None:
        if TRAIL_THRESHOLD_M <= 0 or RETURN_SPEED_MPS <= 0 or RETURN_MARGIN_MIN < 0:
            raise NavigationInputError("항법 임계 환경 변수가 유효하지 않습니다")
        self.registry = registry
        self.gps = gps
        self.waypoints = WaypointStore(waypoint_path)
        self.local_tz = local_tz or configured_timezone()
        self._route_lock = threading.RLock()
        self._route_cache: dict[str, dict[str, Any]] = {}

    def apply_waypoint(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.waypoints.apply(payload, self.gps.snapshot())
        return self.snapshot()

    @staticmethod
    def _location(gps: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
        if gps.get("fix") is True:
            return {"lat": gps["lat"], "lon": gps["lon"]}, "current_fix"
        last_fix = gps.get("last_fix")
        if isinstance(last_fix, dict):
            return {"lat": last_fix["lat"], "lon": last_fix["lon"]}, "last_fix"
        return None, "none"

    def _trail(self, gps: dict[str, Any], location: dict[str, Any] | None) -> dict[str, Any]:
        result = {
            "status": "unavailable",
            "offset_m": None,
            "threshold_m": TRAIL_THRESHOLD_M,
            "accuracy_m": gps.get("acc_m") if gps.get("fix") else None,
            "computed_by": "map_engine",
        }
        if location is None:
            return result
        try:
            offset = float(self.registry.trail_offset_m(location["lat"], location["lon"]))
        except (MapValidationError, ValueError):
            return result
        result["offset_m"] = round(offset, 1)
        if gps.get("fix") is not True:
            result["status"] = "last_fix_only"
            return result
        accuracy = gps.get("acc_m")
        if accuracy is None:
            result["status"] = "off_trail_estimate" if offset > TRAIL_THRESHOLD_M * 2.0 else "accuracy_unknown"
            return result
        accuracy = float(accuracy)
        if offset - accuracy > TRAIL_THRESHOLD_M:
            result["status"] = "off_trail"
        elif offset + accuracy <= TRAIL_THRESHOLD_M:
            result["status"] = "on_trail"
        else:
            result["status"] = "uncertain"
        return result

    def _route_to(
        self,
        gps: dict[str, Any],
        target: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if target is None:
            return {"available": False, "reason": "target_missing"}
        if gps.get("fix") is not True:
            return {"available": False, "reason": "gps_fix_required", "target": target}
        map_source = str(self.registry.overview().get("source_name") or "")
        cache_key = str(target.get("id") or target.get("kind") or "target")
        with self._route_lock:
            cached = self._route_cache.get(cache_key)
        if (
            cached
            and cached["map_source"] == map_source
            and cached["target_lat"] == float(target["lat"])
            and cached["target_lon"] == float(target["lon"])
            and haversine_m(
                float(gps["lon"]),
                float(gps["lat"]),
                cached["start_lon"],
                cached["start_lat"],
            ) < 8.0
        ):
            result = dict(cached["payload"])
            coordinates = result["coordinates"]
            next_point = target
            for lon, lat in coordinates[1:]:
                if haversine_m(float(gps["lon"]), float(gps["lat"]), lon, lat) > 3.0:
                    next_point = {"lat": lat, "lon": lon}
                    break
            result["bearing_deg"] = round(
                _bearing_degrees(
                    {"lat": gps["lat"], "lon": gps["lon"]},
                    next_point,
                )
            )
            result["straight_m"] = round(
                haversine_m(
                    float(gps["lon"]),
                    float(gps["lat"]),
                    float(target["lon"]),
                    float(target["lat"]),
                ),
                1,
            )
            return result
        try:
            route = self.registry.route_between(
                float(gps["lat"]),
                float(gps["lon"]),
                float(target["lat"]),
                float(target["lon"]),
            )
        except (MapValidationError, RouteNotFound, SnapOutOfBounds, ValueError) as exc:
            return {"available": False, "reason": str(exc), "target": target}
        coordinates = [list(point) for point in route.coordinates]
        current_coordinate = [float(gps["lon"]), float(gps["lat"])]
        target_coordinate = [float(target["lon"]), float(target["lat"])]
        if not coordinates or haversine_m(*current_coordinate, *coordinates[0]) > 1.0:
            coordinates.insert(0, current_coordinate)
        if haversine_m(*coordinates[-1], *target_coordinate) > 1.0:
            coordinates.append(target_coordinate)
        next_point = None
        for lon, lat in route.coordinates:
            if haversine_m(float(gps["lon"]), float(gps["lat"]), lon, lat) > 3.0:
                next_point = {"lat": lat, "lon": lon}
                break
        next_point = next_point or target
        payload = {
            "available": True,
            "computed_by": "map_engine",
            "target": target,
            "distance_m": round(
                route.distance_m
                + float(getattr(route, "start_snap_m", 0.0))
                + float(getattr(route, "goal_snap_m", 0.0)),
                1,
            ),
            "straight_m": round(
                haversine_m(float(gps["lon"]), float(gps["lat"]), float(target["lon"]), float(target["lat"])),
                1,
            ),
            "bearing_deg": round(_bearing_degrees({"lat": gps["lat"], "lon": gps["lon"]}, next_point)),
            "coordinates": coordinates,
        }
        with self._route_lock:
            self._route_cache[cache_key] = {
                "map_source": map_source,
                "target_lat": float(target["lat"]),
                "target_lon": float(target["lon"]),
                "start_lat": float(gps["lat"]),
                "start_lon": float(gps["lon"]),
                "payload": payload,
            }
        return payload

    def _sun(
        self,
        gps: dict[str, Any],
        location: dict[str, Any] | None,
        basecamp_route: dict[str, Any],
        now: datetime | None,
    ) -> dict[str, Any]:
        if location is None:
            return {
                "computed": False,
                "reference": "none",
                "status": "gps_required",
                "sunrise": None,
                "sunset": None,
                "civil_end": None,
                "return_by": None,
                "remaining_min": None,
                "return_in_min": None,
            }
        solar = calculate_solar_times(
            location["lat"],
            location["lon"],
            now=now,
            local_tz=self.local_tz,
        )
        current = solar["now"]
        sunset = solar["sunset"]
        result: dict[str, Any] = {
            "computed": solar["computed"],
            "reference": "current_fix" if gps.get("fix") else "last_fix",
            "date": solar["date"],
            "timezone": solar["timezone"],
            "now": iso_or_none(current),
            "sunrise": iso_or_none(solar["sunrise"]),
            "sunrise_clock": clock_or_none(solar["sunrise"]),
            "sunset": iso_or_none(sunset),
            "sunset_clock": clock_or_none(sunset),
            "civil_end": iso_or_none(solar["civil_end"]),
            "civil_end_clock": clock_or_none(solar["civil_end"]),
            "remaining_min": solar["remaining_min"],
            "return_by": None,
            "return_by_clock": None,
            "return_in_min": None,
            "travel_min": None,
            "margin_min": RETURN_MARGIN_MIN,
            "status": "basecamp_required",
        }
        if gps.get("fix") is not True:
            result["status"] = "last_fix_only"
        elif not basecamp_route.get("available"):
            result["status"] = (
                "basecamp_required"
                if basecamp_route.get("reason") == "target_missing"
                else "route_unavailable"
            )
        elif sunset is not None:
            travel_min = int(ceil(float(basecamp_route["distance_m"]) / RETURN_SPEED_MPS / 60.0))
            return_by = sunset - timedelta(minutes=travel_min + RETURN_MARGIN_MIN)
            return_in_min = int(floor((return_by - current).total_seconds() / 60.0))
            result.update(
                {
                    "travel_min": travel_min,
                    "return_by": iso_or_none(return_by),
                    "return_by_clock": clock_or_none(return_by),
                    "return_in_min": return_in_min,
                    "status": "return_now" if return_in_min <= 0 else "scheduled",
                }
            )
        else:
            result["status"] = "sun_event_unavailable"
        return result

    @staticmethod
    def _alert(co: dict[str, Any], trail: dict[str, Any], sun: dict[str, Any]) -> dict[str, Any] | None:
        if co.get("alarm") is True and not co.get("stale"):
            ppm = co.get("ppm")
            value = "—" if ppm is None else f"{float(ppm):.0f}"
            return {
                "kind": "co_alarm",
                "severity": "alarm",
                "text": f"CO 경보 · {value} ppm · STM32 물리 경보 작동",
                "sound": True,
            }
        if trail.get("status") == "off_trail":
            return {
                "kind": "trail",
                "severity": "alarm",
                "text": f"트레일 이탈 · {float(trail['offset_m']):.0f} m · 현재 위치를 확인하세요",
                "sound": False,
            }
        if sun.get("status") == "return_now":
            return {
                "kind": "daylight",
                "severity": "alarm",
                "text": "귀환 권고 시각 도달 · 베이스캠프 경로를 확인하세요",
                "sound": False,
            }
        return None

    def snapshot(self, *, now: datetime | None = None) -> dict[str, Any]:
        gps = self.gps.snapshot()
        waypoints = self.waypoints.snapshot()
        selected = self.waypoints.selected_point()
        location, location_kind = self._location(gps)
        trail = self._trail(gps, location)
        active_route = self._route_to(gps, selected)
        basecamp = waypoints.get("basecamp")
        basecamp_route = active_route if selected and selected.get("id") == "basecamp" else self._route_to(gps, basecamp)
        sun = self._sun(gps, location, basecamp_route, now)
        co = gps["co"]
        overview = self.registry.overview()
        demo = bool(gps.get("demo") or overview.get("demo"))
        alert = self._alert(co, trail, sun)
        return {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "offline": True,
            "demo": demo,
            "map": {
                "name": overview.get("name") or overview.get("source_name") or "오프라인 보행 지도",
                "source_name": overview.get("source_name"),
                "demo": bool(overview.get("demo")),
            },
            "gps": gps,
            "environment": gps["environment"],
            "co": co,
            "power": gps["power"],
            "location_reference": location_kind,
            "trail": trail,
            "sun": sun,
            "waypoints": waypoints,
            "navigation": {
                "selected_target": waypoints.get("selected_target"),
                "active_route": active_route,
                "basecamp_route": basecamp_route,
            },
            "alert": alert,
            "llm_read_only": {
                "gps": {
                    "fix": gps.get("fix", False),
                    "lat": gps.get("lat") if gps.get("fix") else None,
                    "lon": gps.get("lon") if gps.get("fix") else None,
                    "acc_m": gps.get("acc_m") if gps.get("fix") else None,
                    "age_s": gps.get("age_s") if gps.get("fix") else gps.get("last_age_s"),
                },
                "time": {
                    "sunset": sun.get("sunset_clock"),
                    "remaining_min": sun.get("remaining_min"),
                    "return_by": sun.get("return_by_clock"),
                },
                "env": {
                    "temp_c": gps["environment"].get("temp_c") if gps["environment"].get("valid") else None,
                    "humidity": gps["environment"].get("humidity_pct") if gps["environment"].get("valid") else None,
                },
                "route": {
                    "status": trail.get("status"),
                    "offset_m": trail.get("offset_m"),
                    "distance_m": active_route.get("distance_m") if active_route.get("available") else None,
                },
            },
            "contract": {
                "map_route_bearing_distance_computed_by_code": True,
                "solar_computed_offline": True,
                "llm_may_select_saved_waypoint_only": True,
                "llm_may_generate_coordinates": False,
            },
        }
