"""
Apple Health export parser.
Supports: export.zip (contains export.xml) or raw export.xml.
Produces events compatible with our Event model: sleep, steps, workout.
"""
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from io import BytesIO
from typing import Any

# Apple Health type identifiers we use
STEP_TYPE = "HKQuantityTypeIdentifierStepCount"
SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis"
# Sleep value: 0=in bed, 1=asleep, 2=awake, 3=core, 4=deep, 5=REM, 6=unknown
WORKOUT_ELEM = "Workout"
# Workout type mapping (Apple -> our internal)
WORKOUT_TYPE_MAP = {
    "HKWorkoutActivityTypeRunning": "run",
    "HKWorkoutActivityTypeWalking": "walk",
    "HKWorkoutActivityTypeCycling": "cycling",
    "HKWorkoutActivityTypeTraditionalStrengthTraining": "weights",
    "HKWorkoutActivityTypeHighIntensityIntervalTraining": "hiit",
    "HKWorkoutActivityTypeYoga": "yoga",
    "HKWorkoutActivityTypeFunctionalStrengthTraining": "weights",
    "HKWorkoutActivityTypeCoreTraining": "weights",
    "HKWorkoutActivityTypeDance": "walk",
    "HKWorkoutActivityTypeSwimming": "run",  # map to run for calories
    "HKWorkoutActivityTypeElliptical": "cycling",
    "HKWorkoutActivityTypeRowing": "cycling",
    "HKWorkoutActivityTypeStairs": "walk",
    "HKWorkoutActivityTypeHiking": "walk",
    "HKWorkoutActivityTypeMixedCardio": "run",
}


def _parse_apple_date(s: str | None):
    if not s or not s.strip():
        return None
    s = s.strip()
    # "2024-02-27 14:30:00 +0530" or "2024-02-27 14:30:00"
    try:
        # Use first 19 chars as naive datetime, then treat as UTC
        naive = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
        return naive.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _parse_xml_stream(stream) -> tuple[list[dict], list[dict], list[dict]]:
    """Parse export.xml stream; return (steps_list, sleep_list, workouts_list)."""
    steps: list[dict] = []
    sleep: list[dict] = []
    workouts: list[dict] = []

    # Use iterparse to avoid loading huge XML into memory
    context = ET.iterparse(stream, events=("end",))
    for _event, elem in context:
        tag = elem.tag
        attrib = elem.attrib

        if tag == "Record":
            t = attrib.get("type")
            start = _parse_apple_date(attrib.get("startDate"))
            end = _parse_apple_date(attrib.get("endDate"))
            if t == STEP_TYPE and start and end:
                try:
                    value = int(float(attrib.get("value", 0)))
                    steps.append({"start": start, "end": end, "value": value})
                except (TypeError, ValueError):
                    pass
            elif t == SLEEP_TYPE and start and end:
                # value 1 = asleep, 0 = in bed; we use duration for "asleep" only for simplicity
                try:
                    val = int(attrib.get("value", 1))
                    if val in (1, 3, 4, 5):  # asleep, core, deep, REM
                        delta = end - start
                        hours = delta.total_seconds() / 3600
                        sleep.append({"start": start, "end": end, "hours": round(hours, 1)})
                except (TypeError, ValueError):
                    pass
            elem.clear()

        elif tag == WORKOUT_ELEM:
            start = _parse_apple_date(attrib.get("startDate"))
            end = _parse_apple_date(attrib.get("endDate"))
            if start and end:
                duration_sec = (end - start).total_seconds()
                duration_min = max(1, int(duration_sec / 60))
                wtype = attrib.get("workoutActivityType", "HKWorkoutActivityTypeOther")
                our_type = WORKOUT_TYPE_MAP.get(wtype, "run")
                # Calories: Apple sometimes has totalEnergyBurned; else estimate
                try:
                    cal = int(float(attrib.get("totalEnergyBurned", 0)))
                except (TypeError, ValueError):
                    cal = duration_min * 6  # rough default
                if cal <= 0:
                    cal = duration_min * 6
                workouts.append({
                    "start": start,
                    "end": end,
                    "workout_type": our_type,
                    "duration_min": duration_min,
                    "calories": cal,
                    "intensity": "moderate",
                })
            elem.clear()

    return steps, sleep, workouts


def _aggregate_steps_by_day(steps: list[dict], days_back: int) -> list[dict]:
    """Group step records by calendar day (UTC), sum value. Return one event per day."""
    from collections import defaultdict
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    by_day: dict[str, int] = defaultdict(int)
    for r in steps:
        if r["start"] < cutoff:
            continue
        day_key = r["start"].date().isoformat()
        by_day[day_key] += r["value"]
    out = []
    for day_str, total in by_day.items():
        if total <= 0:
            continue
        d = datetime.fromisoformat(day_str).replace(tzinfo=timezone.utc)
        start = d
        end = d + timedelta(hours=15)
        out.append({
            "start": start,
            "end": end,
            "value_json": {"steps": total, "distance_km": round(total * 0.0008, 1)},
        })
    return out


def _aggregate_sleep_by_night(sleep: list[dict], days_back: int) -> list[dict]:
    """One event per night (start = night start, value = hours)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    # Merge overlapping or adjacent sleep segments into one per night
    nights: dict[str, float] = {}
    for r in sleep:
        if r["start"] < cutoff:
            continue
        night_key = (r["start"] - timedelta(hours=6)).date().isoformat()
        nights[night_key] = nights.get(night_key, 0) + r["hours"]
    out = []
    for night_str, hours in nights.items():
        if hours <= 0:
            continue
        d = datetime.fromisoformat(night_str).replace(tzinfo=timezone.utc)
        start = d + timedelta(hours=22)  # e.g. 10 PM
        end = d + timedelta(days=1, hours=6)
        out.append({
            "start": start,
            "end": end,
            "value_json": {"hours": round(hours, 1), "quality": "imported"},
        })
    return out


def _workouts_to_events(workouts: list[dict], days_back: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    out = []
    for w in workouts:
        if w["start"] < cutoff:
            continue
        out.append({
            "start": w["start"],
            "end": w["end"],
            "value_json": {
                "workout_type": w["workout_type"],
                "duration_min": w["duration_min"],
                "calories": w["calories"],
                "intensity": w["intensity"],
            },
        })
    return out


def parse_apple_health_export(file_content: bytes, filename: str | None, days_back: int = 30) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Parse Apple Health export (ZIP or XML).
    Returns (step_events, sleep_events, workout_events) as lists of dicts with keys:
      start, end (datetime), value_json (dict).
    """
    xml_bytes: bytes | None = None
    if filename and filename.lower().endswith(".zip"):
        with zipfile.ZipFile(BytesIO(file_content), "r") as z:
            for name in z.namelist():
                if name.endswith(".xml") and "export" in name.lower():
                    xml_bytes = z.read(name)
                    break
            if xml_bytes is None:
                # Any .xml
                for name in z.namelist():
                    if name.endswith(".xml"):
                        xml_bytes = z.read(name)
                        break
        if xml_bytes is None:
            raise ValueError("ZIP contains no XML file")
    else:
        xml_bytes = file_content

    stream = BytesIO(xml_bytes)
    steps_raw, sleep_raw, workouts_raw = _parse_xml_stream(stream)

    step_events = _aggregate_steps_by_day(steps_raw, days_back)
    sleep_events = _aggregate_sleep_by_night(sleep_raw, days_back)
    workout_events = _workouts_to_events(workouts_raw, days_back)

    return step_events, sleep_events, workout_events
