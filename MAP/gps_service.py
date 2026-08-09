"""Air530 NMEA와 STM32 센서 텔레메트리를 받는 오프라인 직렬 서비스."""

from __future__ import annotations

from dataclasses import dataclass
import json
from math import isfinite
from pathlib import Path
from queue import Empty, Full, Queue
import re
import threading
import time
from typing import Any


FIX_STALE_AFTER_S = 3.0
SENSOR_STALE_AFTER_S = 3.0
SERIAL_RECONNECT_AFTER_S = 2.0
MAX_SERIAL_LINE_BYTES = 4096
SUPPORTED_MODES = {"off", "replay", "air530", "stm32"}
TELEMETRY_VERSION = 1
_CRC_SUFFIX = re.compile(r'^(.*),"crc16":"([0-9A-Fa-f]{4})"}$')


class GpsInputError(ValueError):
    """GNSS 또는 센서 입력 문장이 계약을 만족하지 않을 때 발생한다."""


def _number(
    value: Any,
    label: str,
    *,
    lower: float | None = None,
    upper: float | None = None,
) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise GpsInputError(f"{label} 값이 숫자가 아닙니다") from exc
    if not isfinite(number):
        raise GpsInputError(f"{label} 값이 유한수가 아닙니다")
    if lower is not None and number < lower:
        raise GpsInputError(f"{label} 값이 허용 범위보다 작습니다")
    if upper is not None and number > upper:
        raise GpsInputError(f"{label} 값이 허용 범위보다 큽니다")
    return number


def _optional_number(
    value: Any,
    label: str,
    *,
    lower: float | None = None,
    upper: float | None = None,
) -> float | None:
    if value is None or value == "":
        return None
    return _number(value, label, lower=lower, upper=upper)


def _boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise GpsInputError(f"{label} 값이 bool이 아닙니다")
    return value


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GpsInputError(f"{label} 객체가 없습니다")
    return value


def crc16_ccitt(data: bytes, initial: int = 0xFFFF) -> int:
    """STM32와 공유하는 CRC-16/CCITT-FALSE를 계산한다."""

    crc = initial
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def encode_stm32_telemetry(payload: dict[str, Any]) -> str:
    """테스트·도구에서 펌웨어와 같은 CRC가 붙은 JSON 한 줄을 만든다."""

    if "crc16" in payload:
        raise GpsInputError("crc16은 인코더가 추가합니다")
    base = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    if not base.endswith("}"):
        raise GpsInputError("텔레메트리 루트는 객체여야 합니다")
    checksum = crc16_ccitt(base.encode("ascii"))
    return f'{base[:-1]},"crc16":"{checksum:04X}"}}'


def _nmea_coordinate(raw: str, hemisphere: str, *, latitude: bool) -> float:
    if not raw or hemisphere not in ({"N", "S"} if latitude else {"E", "W"}):
        raise GpsInputError("NMEA 좌표 또는 반구 값이 없습니다")
    value = _number(raw, "NMEA 좌표", lower=0)
    degrees = int(value // 100)
    minutes = value - degrees * 100
    if minutes >= 60:
        raise GpsInputError("NMEA 분 값이 60 이상입니다")
    coordinate = degrees + minutes / 60
    if hemisphere in {"S", "W"}:
        coordinate = -coordinate
    limit = 90 if latitude else 180
    if not -limit <= coordinate <= limit:
        raise GpsInputError("NMEA 좌표가 유효 범위를 벗어났습니다")
    return coordinate


def _nmea_body(line: str) -> str:
    sentence = line.strip()
    if not sentence.startswith("$") or "*" not in sentence:
        raise GpsInputError("NMEA 시작 문자 또는 체크섬이 없습니다")
    body, checksum_text = sentence[1:].rsplit("*", 1)
    if len(checksum_text) < 2:
        raise GpsInputError("NMEA 체크섬 길이가 잘못됐습니다")
    checksum = 0
    for character in body:
        checksum ^= ord(character)
    try:
        expected = int(checksum_text[:2], 16)
    except ValueError as exc:
        raise GpsInputError("NMEA 체크섬이 16진수가 아닙니다") from exc
    if checksum != expected:
        raise GpsInputError("NMEA 체크섬이 일치하지 않습니다")
    return body


class NmeaParser:
    """Air530에서 필요한 GGA·RMC 문장만 엄격하게 읽는다."""

    def parse(self, line: str) -> dict[str, Any] | None:
        body = _nmea_body(line)
        fields = body.split(",")
        sentence_type = fields[0][-3:]
        if sentence_type == "GGA":
            return self._parse_gga(fields)
        if sentence_type == "RMC":
            return self._parse_rmc(fields)
        return None

    @staticmethod
    def _parse_gga(fields: list[str]) -> dict[str, Any]:
        if len(fields) < 10:
            raise GpsInputError("GGA 필드가 부족합니다")
        quality = int(_number(fields[6] or 0, "GGA fix quality", lower=0, upper=8))
        satellites = int(_number(fields[7] or 0, "GGA 위성 수", lower=0, upper=99))
        hdop = _optional_number(fields[8], "GGA HDOP", lower=0)
        result: dict[str, Any] = {
            "fix": quality > 0,
            "utc": fields[1] or None,
            "satellites": satellites,
            "hdop": hdop,
            "acc_m": None,
            "accuracy_kind": "unknown",
            "sentence": "GGA",
        }
        if quality > 0:
            result["lat"] = _nmea_coordinate(fields[2], fields[3], latitude=True)
            result["lon"] = _nmea_coordinate(fields[4], fields[5], latitude=False)
            result["alt_m"] = _optional_number(fields[9], "GGA 고도")
        return result

    @staticmethod
    def _parse_rmc(fields: list[str]) -> dict[str, Any]:
        if len(fields) < 10:
            raise GpsInputError("RMC 필드가 부족합니다")
        fix = fields[2] == "A"
        result: dict[str, Any] = {
            "fix": fix,
            "utc": fields[1] or None,
            "date": fields[9] or None,
            "speed_knots": _optional_number(fields[7], "RMC 속도", lower=0),
            "course_deg": _optional_number(fields[8], "RMC 진행각", lower=0, upper=360),
            "acc_m": None,
            "accuracy_kind": "unknown",
            "sentence": "RMC",
        }
        if fix:
            result["lat"] = _nmea_coordinate(fields[3], fields[4], latitude=True)
            result["lon"] = _nmea_coordinate(fields[5], fields[6], latitude=False)
        return result


def _parse_telemetry_gps(value: Any) -> dict[str, Any]:
    gps = _object(value, "STM32 gps")
    fix = _boolean(gps.get("fix"), "STM32 gps.fix")
    result: dict[str, Any] = {
        "fix": fix,
        "satellites": int(_number(gps.get("sats", 0), "STM32 위성 수", lower=0, upper=99)),
        "hdop": _optional_number(gps.get("hdop"), "STM32 HDOP", lower=0, upper=99.9),
        "acc_m": _optional_number(gps.get("acc_m"), "STM32 정확도", lower=0, upper=10_000),
        "age_s": _optional_number(gps.get("age_s"), "STM32 좌표 경과 시간", lower=0),
        "last_age_s": _optional_number(gps.get("last_age_s"), "STM32 마지막 좌표 경과 시간", lower=0),
        "accuracy_kind": "reported" if gps.get("acc_m") is not None else "unknown",
        "sentence": "STM32_TELEMETRY",
    }
    if fix:
        result["lat"] = _number(gps.get("lat"), "STM32 위도", lower=-90, upper=90)
        result["lon"] = _number(gps.get("lon"), "STM32 경도", lower=-180, upper=180)
    return result


def _parse_telemetry_environment(value: Any) -> dict[str, Any]:
    env = _object(value, "STM32 env")
    valid = _boolean(env.get("valid"), "STM32 env.valid")
    result: dict[str, Any] = {
        "valid": valid,
        "temp_c": None,
        "humidity_pct": None,
        "age_s": _optional_number(env.get("age_s"), "STM32 환경 경과 시간", lower=0),
    }
    if valid:
        result["temp_c"] = _number(env.get("temp_c"), "STM32 온도", lower=-45, upper=130)
        result["humidity_pct"] = _number(env.get("humidity_pct"), "STM32 습도", lower=0, upper=100)
    return result


def _parse_telemetry_co(value: Any) -> dict[str, Any]:
    co = _object(value, "STM32 co")
    valid = _boolean(co.get("valid"), "STM32 co.valid")
    warming_up = _boolean(co.get("warming_up", False), "STM32 co.warming_up")
    alarm = _boolean(co.get("alarm", False), "STM32 co.alarm")
    level = str(co.get("level", "unknown"))
    if level not in {"unknown", "normal", "warning", "alarm"}:
        raise GpsInputError("STM32 CO level 값이 올바르지 않습니다")
    if alarm and level != "alarm":
        raise GpsInputError("STM32 CO alarm과 level이 일치하지 않습니다")
    ppm = _optional_number(co.get("ppm"), "STM32 CO 농도", lower=0, upper=10_000)
    if valid and ppm is None:
        raise GpsInputError("유효한 STM32 CO 값에 ppm이 없습니다")
    return {
        "valid": valid,
        "warming_up": warming_up,
        "ppm": ppm,
        "level": level,
        "alarm": alarm,
        "age_s": _optional_number(co.get("age_s"), "STM32 CO 경과 시간", lower=0),
    }


def _parse_telemetry_power(value: Any) -> dict[str, Any]:
    if value is None:
        return {"valid": False, "percent": None, "days_left": None}
    power = _object(value, "STM32 power")
    valid = _boolean(power.get("valid"), "STM32 power.valid")
    return {
        "valid": valid,
        "percent": _optional_number(power.get("percent"), "STM32 배터리", lower=0, upper=100),
        "days_left": _optional_number(power.get("days_left"), "STM32 배터리 잔여 일수", lower=0),
    }


def parse_stm32_telemetry(line: str) -> dict[str, Any] | None:
    """CRC가 붙은 STM32 `event=telemetry` 한 줄을 검증·정규화한다."""

    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        raise GpsInputError("STM32 응답이 JSON이 아닙니다") from exc
    if not isinstance(payload, dict):
        raise GpsInputError("STM32 응답 루트가 객체가 아닙니다")
    if payload.get("event") != "telemetry":
        return None

    match = _CRC_SUFFIX.fullmatch(line.strip())
    if not match:
        raise GpsInputError("STM32 텔레메트리에 마지막 crc16 필드가 없습니다")
    base = match.group(1) + "}"
    expected = int(match.group(2), 16)
    actual = crc16_ccitt(base.encode("ascii"))
    if actual != expected:
        raise GpsInputError("STM32 텔레메트리 CRC16이 일치하지 않습니다")

    version = int(_number(payload.get("v"), "STM32 프로토콜 버전", lower=1, upper=255))
    if version != TELEMETRY_VERSION:
        raise GpsInputError(f"지원하지 않는 STM32 프로토콜 버전입니다: {version}")
    sequence = int(_number(payload.get("seq"), "STM32 시퀀스", lower=0, upper=4_294_967_295))
    uptime_ms = int(_number(payload.get("uptime_ms"), "STM32 가동 시간", lower=0))
    return {
        "version": version,
        "sequence": sequence,
        "uptime_ms": uptime_ms,
        "gps": _parse_telemetry_gps(payload.get("gps")),
        "environment": _parse_telemetry_environment(payload.get("env")),
        "co": _parse_telemetry_co(payload.get("co")),
        "power": _parse_telemetry_power(payload.get("power")),
    }


def parse_stm32_fix(line: str) -> dict[str, Any] | None:
    """기존 `event=fix` 응답과 새 텔레메트리의 GPS 부분을 검증한다."""

    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        raise GpsInputError("STM32 응답이 JSON이 아닙니다") from exc
    if not isinstance(payload, dict):
        raise GpsInputError("STM32 응답 루트가 객체가 아닙니다")
    if payload.get("event") == "telemetry":
        telemetry = parse_stm32_telemetry(line)
        return None if telemetry is None else telemetry["gps"]
    if payload.get("event") != "fix":
        return None
    if payload.get("ok") is not True:
        raise GpsInputError(str(payload.get("reason", "STM32 fix 요청 실패")))

    inferred_fix = payload.get("lat") is not None and payload.get("lon") is not None
    fix = payload.get("fix", inferred_fix) is True
    if not fix:
        return {
            "fix": False,
            "last_age_s": _optional_number(payload.get("last_age_s"), "마지막 좌표 경과 시간", lower=0),
            "sentence": "STM32_JSON",
        }

    acc_m = _optional_number(payload.get("acc_m"), "STM32 정확도", lower=0)
    return {
        "fix": True,
        "lat": _number(payload.get("lat"), "STM32 위도", lower=-90, upper=90),
        "lon": _number(payload.get("lon"), "STM32 경도", lower=-180, upper=180),
        "acc_m": acc_m,
        "accuracy_kind": "reported" if acc_m is not None else "unknown",
        "satellites": int(_number(payload.get("sats", 0), "STM32 위성 수", lower=0, upper=99)),
        "age_s": _optional_number(payload.get("age_s"), "STM32 좌표 경과 시간", lower=0),
        "sentence": "STM32_JSON",
    }


@dataclass(frozen=True)
class GpsConfiguration:
    mode: str = "off"
    port: str = ""
    baud: int = 0
    replay_path: str = ""


class GpsService:
    """직렬 수신 스레드와 화면용 최신 센서 상태를 관리한다."""

    def __init__(self, default_replay_path: str | Path) -> None:
        self.default_replay_path = Path(default_replay_path)
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._subscribers: set[Queue[dict[str, Any]]] = set()
        self._configuration = GpsConfiguration()
        self._nmea_parser = NmeaParser()
        self._reset_state("off")

    def _reset_state(self, mode: str) -> None:
        self._last_fix: dict[str, Any] | None = None
        self._last_fix_monotonic: float | None = None
        self._current_fix = False
        self._last_environment: dict[str, Any] | None = None
        self._last_environment_monotonic: float | None = None
        self._last_co: dict[str, Any] | None = None
        self._last_co_monotonic: float | None = None
        self._last_power: dict[str, Any] | None = None
        self._last_power_monotonic: float | None = None
        self._state: dict[str, Any] = {
            "mode": mode,
            "source": mode if mode != "off" else "none",
            "connected": False,
            "error": None,
            "received_lines": 0,
            "rejected_lines": 0,
            "reported_last_age_s": None,
            "telemetry_version": None,
            "telemetry_sequence": None,
            "telemetry_uptime_ms": None,
            "sequence_gaps": 0,
        }

    def configure(
        self,
        *,
        mode: str,
        port: str = "",
        baud: int | None = None,
        replay_path: str | Path | None = None,
    ) -> dict[str, Any]:
        if mode not in SUPPORTED_MODES:
            raise GpsInputError(f"지원하지 않는 GPS 모드입니다: {mode}")
        if mode in {"air530", "stm32"} and not port:
            raise GpsInputError("직렬 포트 경로가 필요합니다")
        selected_baud = 0 if mode == "off" else int(baud or (115200 if mode == "stm32" else 9600))
        if mode != "off" and selected_baud <= 0:
            raise GpsInputError("baud는 0보다 커야 합니다")
        selected_replay = Path(replay_path or self.default_replay_path)

        self.stop()
        with self._lock:
            self._configuration = GpsConfiguration(
                mode=mode,
                port=port,
                baud=selected_baud,
                replay_path=str(selected_replay),
            )
            self._reset_state(mode)
            self._stop_event = threading.Event()

        if mode == "off":
            self._publish()
            return self.snapshot()
        target = self._run_replay if mode == "replay" else self._run_serial
        self._thread = threading.Thread(target=target, name=f"sensor-{mode}", daemon=True)
        self._thread.start()
        return self.snapshot()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2.5)
        self._thread = None

    def close(self) -> None:
        self.stop()

    @staticmethod
    def _aged_sensor(
        value: dict[str, Any] | None,
        received_at: float | None,
        now: float,
        empty: dict[str, Any],
    ) -> dict[str, Any]:
        if value is None or received_at is None:
            return dict(empty)
        result = dict(value)
        age_s = max(0.0, now - received_at) + float(value.get("device_age_s") or 0.0)
        result.pop("device_age_s", None)
        result["age_s"] = round(age_s, 1)
        result["stale"] = age_s > SENSOR_STALE_AFTER_S
        if result["stale"]:
            result["valid"] = False
        return result

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            now = time.monotonic()
            result = dict(self._state)
            result["configuration"] = {
                "mode": self._configuration.mode,
                "port": self._configuration.port,
                "baud": self._configuration.baud,
            }
            if self._last_fix and self._last_fix_monotonic is not None:
                local_age = max(0.0, now - self._last_fix_monotonic)
                device_age = self._last_fix.get("device_age_s") or 0.0
                age_s = round(local_age + device_age, 1)
                last_fix = {key: value for key, value in self._last_fix.items() if key != "device_age_s"}
                last_fix["age_s"] = age_s
                result["last_fix"] = last_fix
                live = self._current_fix and local_age <= FIX_STALE_AFTER_S
                result["fix"] = live
                if live:
                    result.update(last_fix)
                else:
                    result["last_age_s"] = age_s
            else:
                result["fix"] = False
                result["last_fix"] = None
                if result.get("reported_last_age_s") is not None:
                    result["last_age_s"] = result["reported_last_age_s"]

            result["environment"] = self._aged_sensor(
                self._last_environment,
                self._last_environment_monotonic,
                now,
                {"valid": False, "temp_c": None, "humidity_pct": None, "age_s": None, "stale": True},
            )
            result["co"] = self._aged_sensor(
                self._last_co,
                self._last_co_monotonic,
                now,
                {
                    "valid": False,
                    "warming_up": False,
                    "ppm": None,
                    "level": "unknown",
                    "alarm": False,
                    "age_s": None,
                    "stale": True,
                },
            )
            result["power"] = self._aged_sensor(
                self._last_power,
                self._last_power_monotonic,
                now,
                {"valid": False, "percent": None, "days_left": None, "age_s": None, "stale": True},
            )
            result["demo"] = self._configuration.mode == "replay"
            result.pop("reported_last_age_s", None)
            return result

    def subscribe(self) -> Queue[dict[str, Any]]:
        subscriber: Queue[dict[str, Any]] = Queue(maxsize=1)
        with self._lock:
            self._subscribers.add(subscriber)
        subscriber.put_nowait(self.snapshot())
        return subscriber

    def unsubscribe(self, subscriber: Queue[dict[str, Any]]) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)

    def ports(self) -> list[dict[str, str]]:
        try:
            from serial.tools import list_ports  # type: ignore
        except ImportError:
            return []
        return [
            {
                "device": str(port.device),
                "description": str(port.description or ""),
                "hwid": str(port.hwid or ""),
            }
            for port in list_ports.comports()
        ]

    def _run_replay(self) -> None:
        path = Path(self._configuration.replay_path)
        try:
            lines = [
                line.strip()
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
            if not lines:
                raise GpsInputError("NMEA 재생 파일이 비어 있습니다")
            self._set_connection(True, None)
            index = 0
            while not self._stop_event.is_set():
                self._handle_line(lines[index % len(lines)], mode="replay")
                index += 1
                self._stop_event.wait(1.0)
        except Exception as exc:
            self._set_connection(False, str(exc))

    def _run_serial(self) -> None:
        try:
            import serial  # type: ignore
        except ImportError:
            self._set_connection(False, "pyserial이 설치되지 않았습니다")
            return
        configuration = self._configuration
        while not self._stop_event.is_set():
            try:
                with serial.Serial(configuration.port, configuration.baud, timeout=1.0) as connection:
                    self._set_connection(True, None)
                    if configuration.mode == "stm32":
                        connection.write(b"STREAM ON\n")
                        connection.flush()
                    while not self._stop_event.is_set():
                        raw = connection.readline(MAX_SERIAL_LINE_BYTES)
                        if raw:
                            self._handle_line(
                                raw.decode("ascii", errors="replace").strip(),
                                mode=configuration.mode,
                            )
                        else:
                            self._publish()
            except Exception as exc:
                self._set_connection(False, str(exc))
                self._stop_event.wait(SERIAL_RECONNECT_AFTER_S)

    def _apply_fix(self, parsed: dict[str, Any]) -> None:
        self._current_fix = parsed.get("fix") is True
        if self._current_fix:
            previous = self._last_fix or {}
            self._last_fix = {
                "lat": parsed["lat"],
                "lon": parsed["lon"],
                "acc_m": parsed.get("acc_m", previous.get("acc_m")),
                "accuracy_kind": parsed.get("accuracy_kind", previous.get("accuracy_kind", "unknown")),
                "satellites": parsed.get("satellites", previous.get("satellites")),
                "hdop": parsed.get("hdop", previous.get("hdop")),
                "alt_m": parsed.get("alt_m", previous.get("alt_m")),
                "utc": parsed.get("utc", previous.get("utc")),
                "device_age_s": parsed.get("age_s") or 0.0,
            }
            self._last_fix_monotonic = time.monotonic()
            self._state["reported_last_age_s"] = None
        elif parsed.get("last_age_s") is not None:
            reported_age = parsed["last_age_s"]
            self._state["reported_last_age_s"] = reported_age
            if self._last_fix is not None:
                self._last_fix["device_age_s"] = reported_age
                self._last_fix_monotonic = time.monotonic()

    def _apply_telemetry(self, telemetry: dict[str, Any]) -> None:
        previous_sequence = self._state.get("telemetry_sequence")
        previous_uptime = self._state.get("telemetry_uptime_ms")
        sequence = telemetry["sequence"]
        uptime = telemetry["uptime_ms"]
        if (
            previous_sequence is not None
            and previous_uptime is not None
            and uptime >= previous_uptime
            and sequence != ((int(previous_sequence) + 1) & 0xFFFFFFFF)
        ):
            self._state["sequence_gaps"] += 1
        self._state["telemetry_version"] = telemetry["version"]
        self._state["telemetry_sequence"] = sequence
        self._state["telemetry_uptime_ms"] = uptime
        self._apply_fix(telemetry["gps"])
        now = time.monotonic()
        self._last_environment = dict(telemetry["environment"])
        self._last_environment["device_age_s"] = self._last_environment.pop("age_s") or 0.0
        self._last_environment_monotonic = now
        self._last_co = dict(telemetry["co"])
        self._last_co["device_age_s"] = self._last_co.pop("age_s") or 0.0
        self._last_co_monotonic = now
        self._last_power = dict(telemetry["power"])
        self._last_power["device_age_s"] = 0.0
        self._last_power_monotonic = now

    def _handle_line(self, line: str, *, mode: str) -> None:
        if not line:
            return
        with self._lock:
            self._state["received_lines"] += 1
        try:
            telemetry = parse_stm32_telemetry(line) if mode == "stm32" else None
            parsed = None
            if telemetry is None:
                parsed = parse_stm32_fix(line) if mode == "stm32" else self._nmea_parser.parse(line)
        except (GpsInputError, UnicodeEncodeError) as exc:
            with self._lock:
                self._state["rejected_lines"] += 1
                self._state["error"] = str(exc)
            self._publish()
            return
        if telemetry is None and parsed is None:
            return
        with self._lock:
            self._state["error"] = None
            if telemetry is not None:
                self._apply_telemetry(telemetry)
            elif parsed is not None:
                self._apply_fix(parsed)
        self._publish()

    def _set_connection(self, connected: bool, error: str | None) -> None:
        with self._lock:
            self._state["connected"] = connected
            self._state["error"] = error
            if not connected:
                self._current_fix = False
        self._publish()

    def _publish(self) -> None:
        snapshot = self.snapshot()
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(snapshot)
            except Full:
                try:
                    subscriber.get_nowait()
                except Empty:
                    pass
                try:
                    subscriber.put_nowait(snapshot)
                except Full:
                    pass
