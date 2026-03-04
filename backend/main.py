import asyncio
import json
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine, get_db
from health_import import parse_apple_health_export
from models import Event, Goal, Meal, Notification, NotificationPreferences, UserProfile, WaterLog
from reka_client import analyze_food_image, analyze_food_text
from settings import settings
from tavily_client import tavily_search
from twilio_client import send_sms as twilio_send_sms
from sendgrid_client import send_email as sendgrid_send_email

# ── DB bootstrap ─────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="LifeOS Agent API", version="1.0.0")

# Explicit origins so credentials work; * with credentials is invalid in CORS
_CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure 500 and other errors still send CORS headers (browser would otherwise hide the response)
def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": _CORS_ORIGINS[0],
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
    }


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "error": "Internal server error"},
        headers=_cors_headers(),
    )


# ── Notification helpers ──────────────────────────────────────────────────────

def _push(db: Session, user_id: str, ntype: str, title: str, message: str) -> Notification:
    n = Notification(user_id=user_id, type=ntype, title=title, message=message)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def _seed_notifications(user_id: str, summary: dict, count: int) -> None:
    db = SessionLocal()
    try:
        _push(
            db, user_id, "seed_complete",
            "Week data ready! 🎉",
            f"Seeded {count} health events. Avg sleep {summary['avg_sleep_hrs']}h · "
            f"Avg {summary['avg_steps']:,} steps/day · {summary['workout_count']} workouts this week.",
        )
        if summary["avg_sleep_hrs"] < 6.5:
            _push(
                db, user_id, "sleep_warning",
                "Sleep deficit detected 😴",
                f"Your 7-day average is only {summary['avg_sleep_hrs']}h. "
                "Aim for 7–9 hours. Try a consistent bedtime and limiting screens after 9 pm.",
            )
        if summary["workout_count"] >= 4:
            top = (list(summary["workout_breakdown"].keys()) or ["mixed"])[0]
            _push(
                db, user_id, "workout_great",
                "You're crushing it! 💪",
                f"{summary['workout_count']} workouts detected. Top activity: {top}. "
                "Recovery days are equally important — listen to your body!",
            )
        elif summary["workout_count"] < 2:
            _push(
                db, user_id, "workout_reminder",
                "Time to get moving 🏃",
                f"Only {summary['workout_count']} workout(s) this week. "
                "Even a 30-min brisk walk daily makes a big difference!",
            )
        if summary["avg_steps"] < 5000:
            _push(
                db, user_id, "steps_low",
                "Step count is low this week 👟",
                f"Averaging {summary['avg_steps']:,} steps/day — below the 8k target. "
                "Take the stairs, park further, or add a lunchtime walk.",
            )
    finally:
        db.close()


def _meal_notifications(user_id: str, analysis: dict) -> None:
    db = SessionLocal()
    try:
        cal = analysis.get("estimated_calories")
        items = analysis.get("items", [])
        names = [i.get("name", "item") for i in items[:3]]
        macros = analysis.get("estimated_macros") or {}
        meal_name = ", ".join(names) if names else "your meal"

        if cal and cal > 700:
            _push(
                db, user_id, "meal_high_cal",
                "High-calorie meal logged 🍽️",
                f"{meal_name.capitalize()} is ~{cal} kcal. A 25-min walk burns ~200 kcal — "
                "great way to balance it out and aid digestion!",
            )
        elif cal and cal < 300:
            _push(
                db, user_id, "meal_low_cal",
                "Light meal — fuel up! 🥗",
                f"{meal_name.capitalize()} was ~{cal} kcal. Make sure you're hitting your "
                "daily energy needs — consider adding protein or healthy fats.",
            )
        else:
            _push(
                db, user_id, "meal_logged",
                "Meal analysed ✅",
                f"Logged: {meal_name} (~{cal or '?'} kcal). Keep the streak going!",
            )

        carbs = macros.get("carbs_g", 0) or 0
        protein = macros.get("protein_g", 0) or 0
        if carbs > 60:
            _push(
                db, user_id, "workout_tip",
                "Great carb fuel ⚡",
                "High-carb meal detected — your glycogen stores are topped up. "
                "Perfect time for a workout in the next 1–2 hours!",
            )
        if protein < 20 and cal and cal > 400:
            _push(
                db, user_id, "protein_tip",
                "Low protein alert 🥩",
                f"Only ~{protein}g protein in this meal. "
                "Aim for 25–35g per meal to support muscle repair and satiety.",
            )
    finally:
        db.close()


# ── TDEE / nutrition helpers ─────────────────────────────────────────────────

ACTIVITY_MULT = {
    "sedentary": 1.2, "light": 1.375, "moderate": 1.55,
    "active": 1.725, "very_active": 1.9,
}

GOAL_DELTA = {"lose": -500, "maintain": 0, "gain": +300}


def _calc_tdee(profile: "UserProfile") -> dict:
    """Mifflin-St Jeor BMR × activity multiplier, adjusted for goal."""
    w = profile.weight_kg or 70
    h = profile.height_cm or 170
    a = profile.age or 30
    g = profile.gender or "male"
    goal = profile.goal or "maintain"
    act = profile.activity_level or "moderate"

    if g == "female":
        bmr = 10 * w + 6.25 * h - 5 * a - 161
    else:
        bmr = 10 * w + 6.25 * h - 5 * a + 5

    tdee = round(bmr * ACTIVITY_MULT.get(act, 1.55))
    target_cal = tdee + GOAL_DELTA.get(goal, 0)
    protein_g = round(w * 2.0)  # 2g per kg body weight
    carbs_g = round((target_cal * 0.45) / 4)
    fat_g = round((target_cal * 0.30) / 9)
    water_ml = round(w * 35)  # 35ml per kg

    return {
        "bmr": round(bmr),
        "tdee": tdee,
        "target_calories": target_cal,
        "protein_g": protein_g,
        "carbs_g": carbs_g,
        "fat_g": fat_g,
        "water_ml": water_ml,
    }


def _default_targets(db: Session, user_id: str) -> dict:
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if profile and profile.weight_kg:
        return _calc_tdee(profile)
    goal = db.query(Goal).filter(Goal.user_id == user_id).first()
    gj = (goal.goal_json or {}) if goal else {}
    return {
        "bmr": None,
        "tdee": None,
        "target_calories": gj.get("daily_calories", 2000),
        "protein_g": gj.get("protein_g", 150),
        "carbs_g": gj.get("carbs_g", 225),
        "fat_g": gj.get("fat_g", 65),
        "water_ml": 2500,
    }


# ── Aggregation helpers ───────────────────────────────────────────────────────

def _today_data(db: Session, user_id: str) -> dict:
    today = datetime.now(timezone.utc).date()
    t0 = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    t1 = t0 + timedelta(days=1)

    events = (
        db.query(Event)
        .filter(Event.user_id == user_id, Event.start_ts >= t0, Event.start_ts < t1)
        .all()
    )

    sleep_hrs = 0.0
    steps = 0
    cal_burned = 0
    workouts = []

    for e in events:
        v = e.value_json or {}
        if e.type == "sleep":
            sleep_hrs += float(v.get("hours", 0))
        elif e.type == "steps":
            steps += int(v.get("steps", 0))
        elif e.type == "workout":
            cal_burned += int(v.get("calories", 0))
            workouts.append(
                {
                    "id": e.id,
                    "type": v.get("workout_type", "workout"),
                    "duration_min": v.get("duration_min", 0),
                    "calories": v.get("calories", 0),
                    "intensity": v.get("intensity", "moderate"),
                }
            )

    meal = (
        db.query(Meal)
        .filter(Meal.user_id == user_id)
        .order_by(desc(Meal.ts))
        .first()
    )
    last_meal = None
    if meal:
        rj = meal.reka_json or {}
        last_meal = {
            "id": meal.id,
            "items": rj.get("items", []),
            "estimated_calories": rj.get("estimated_calories"),
            "ts": meal.ts.isoformat(),
        }

    return {
        "date": today.isoformat(),
        "sleep_hrs": round(sleep_hrs, 1),
        "steps": steps,
        "calories_burned": cal_burned,
        "workouts": workouts,
        "last_meal": last_meal,
    }


def _week_data(db: Session, user_id: str) -> dict:
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    events = (
        db.query(Event)
        .filter(Event.user_id == user_id, Event.start_ts >= week_ago)
        .all()
    )

    total_sleep = total_steps = total_cal = workouts = 0
    wtype_counts: dict = {}
    daily: dict = {}

    for e in events:
        v = e.value_json or {}
        day = e.start_ts.date().isoformat()
        if day not in daily:
            daily[day] = {"sleep": 0.0, "steps": 0, "calories": 0, "workouts": 0}
        if e.type == "sleep":
            h = float(v.get("hours", 0))
            total_sleep += h
            daily[day]["sleep"] = round(daily[day]["sleep"] + h, 1)
        elif e.type == "steps":
            s = int(v.get("steps", 0))
            total_steps += s
            daily[day]["steps"] += s
        elif e.type == "workout":
            c = int(v.get("calories", 0))
            total_cal += c
            workouts += 1
            daily[day]["calories"] += c
            daily[day]["workouts"] += 1
            wt = v.get("workout_type", "other")
            wtype_counts[wt] = wtype_counts.get(wt, 0) + 1

    days = max(len(daily), 1)
    return {
        "days_tracked": days,
        "avg_sleep_hrs": round(total_sleep / days, 1),
        "avg_steps": int(total_steps / days),
        "total_calories_burned": total_cal,
        "workout_count": workouts,
        "workout_breakdown": wtype_counts,
        "daily_breakdown": [{"date": k, **v} for k, v in sorted(daily.items())],
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/healthz", tags=["meta"])
def healthz():
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


# Seed -----------------------------------------------------------------
class SeedRequest(BaseModel):
    user_id: str
    days: int = 7


@app.post("/seed/synthetic", tags=["data"])
def seed_synthetic(
    req: SeedRequest,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
):
    db.query(Event).filter(Event.user_id == req.user_id).delete()
    db.commit()

    WTYPE = ["run", "weights", "walk", "cycling", "yoga", "hiit"]
    INTENSITY = ["light", "moderate", "intense"]
    CAL_PER_MIN = {"run": 8, "weights": 6, "walk": 4, "cycling": 7, "yoga": 3, "hiit": 10}
    INT_MULT = {"light": 0.7, "moderate": 1.0, "intense": 1.4}

    now = datetime.now(timezone.utc)
    count = 0

    for offset in range(req.days, 0, -1):
        day = now - timedelta(days=offset)
        day = day.replace(hour=0, minute=0, second=0, microsecond=0)

        # Sleep
        hrs = round(random.uniform(5.5, 8.5), 1)
        db.add(
            Event(
                user_id=req.user_id,
                type="sleep",
                start_ts=day - timedelta(hours=hrs),
                end_ts=day + timedelta(hours=random.randint(6, 8)),
                value_json={"hours": hrs, "quality": random.choice(["poor", "fair", "good", "excellent"])},
            )
        )
        count += 1

        # Steps
        steps = random.randint(2000, 14000)
        db.add(
            Event(
                user_id=req.user_id,
                type="steps",
                start_ts=day + timedelta(hours=7),
                end_ts=day + timedelta(hours=22),
                value_json={"steps": steps, "distance_km": round(steps * 0.0008, 1)},
            )
        )
        count += 1

        # Workouts
        for _ in range(random.choices([0, 1, 2], weights=[30, 50, 20])[0]):
            wt = random.choice(WTYPE)
            dur = random.randint(20, 75)
            inten = random.choice(INTENSITY)
            cal = int(dur * CAL_PER_MIN.get(wt, 5) * INT_MULT[inten])
            ws = day + timedelta(hours=random.randint(6, 20))
            db.add(
                Event(
                    user_id=req.user_id,
                    type="workout",
                    start_ts=ws,
                    end_ts=ws + timedelta(minutes=dur),
                    value_json={
                        "workout_type": wt,
                        "duration_min": dur,
                        "calories": cal,
                        "intensity": inten,
                    },
                )
            )
            count += 1

        # Screen time
        db.add(
            Event(
                user_id=req.user_id,
                type="screen_time",
                start_ts=day + timedelta(hours=8),
                end_ts=day + timedelta(hours=22),
                value_json={"hours": round(random.uniform(1, 10), 1)},
            )
        )
        count += 1

    db.commit()

    summary = _week_data(db, req.user_id)
    bg.add_task(_seed_notifications, req.user_id, summary, count)

    return {
        "success": True,
        "events_created": count,
        "date_range": {
            "start": (now - timedelta(days=req.days)).date().isoformat(),
            "end": now.date().isoformat(),
        },
    }


# Apple Health import & sync -------------------------------------------
@app.post("/health/import", tags=["data"])
async def health_import(
    user_id: str = Form(...),
    days_back: int = Form(30),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    bg: BackgroundTasks = None,
):
    """
    Import Apple Health export (ZIP or export.xml).
    On iPhone: Health app → Profile (top right) → Export All Health Data → share the ZIP.
    Replaces steps/sleep/workouts for the last `days_back` days with imported data.
    """
    content = await file.read()
    filename = file.filename or ""
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        step_events, sleep_events, workout_events = parse_apple_health_export(
            content, filename, days_back=days_back
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {e}")

    # Remove existing steps/sleep/workout in the imported window so we don't duplicate
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    db.query(Event).filter(
        Event.user_id == user_id,
        Event.type.in_(["steps", "sleep", "workout"]),
        Event.start_ts >= cutoff,
    ).delete(synchronize_session=False)
    db.commit()

    count = 0
    for ev in step_events:
        db.add(
            Event(
                user_id=user_id,
                type="steps",
                start_ts=ev["start"],
                end_ts=ev["end"],
                value_json=ev["value_json"],
            )
        )
        count += 1
    for ev in sleep_events:
        db.add(
            Event(
                user_id=user_id,
                type="sleep",
                start_ts=ev["start"],
                end_ts=ev["end"],
                value_json=ev["value_json"],
            )
        )
        count += 1
    for ev in workout_events:
        db.add(
            Event(
                user_id=user_id,
                type="workout",
                start_ts=ev["start"],
                end_ts=ev["end"],
                value_json=ev["value_json"],
            )
        )
        count += 1
    db.commit()

    if bg:
        summary = _week_data(db, user_id)
        bg.add_task(_seed_notifications, user_id, summary, count)

    return {
        "success": True,
        "events_created": count,
        "steps_days": len(step_events),
        "sleep_nights": len(sleep_events),
        "workouts": len(workout_events),
    }


class HealthSyncRequest(BaseModel):
    user_id: str
    steps: list[dict] = []   # [{"date": "2024-02-27", "value": 8000}]
    sleep: list[dict] = []  # [{"date": "2024-02-26", "hours": 7.5}]
    workouts: list[dict] = []  # [{"start": "2024-02-27T08:00:00Z", "end": "...", "workout_type": "run", "duration_min": 30, "calories": 240}]


@app.post("/health/sync", tags=["data"])
def health_sync(req: HealthSyncRequest, db: Session = Depends(get_db)):
    """
    For a future iPhone app: push steps, sleep, workouts from HealthKit to LifeOS.
    POST JSON: { user_id, steps: [{date, value}], sleep: [{date, hours}], workouts: [{start, end, workout_type, duration_min, calories}] }
    """
    count = 0
    for s in req.steps:
        date_str = s.get("date")
        value = s.get("value", 0)
        if not date_str or value is None:
            continue
        try:
            d = datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
        except Exception:
            continue
        start = datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc)
        end = start + timedelta(hours=15)
        db.add(
            Event(
                user_id=req.user_id,
                type="steps",
                start_ts=start,
                end_ts=end,
                value_json={"steps": int(value), "distance_km": round(int(value) * 0.0008, 1)},
            )
        )
        count += 1
    for sl in req.sleep:
        date_str = sl.get("date")
        hours = sl.get("hours", 0)
        if not date_str or hours is None:
            continue
        try:
            d = datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
        except Exception:
            continue
        start = datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc) - timedelta(hours=float(hours))
        end = datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc) + timedelta(hours=8)
        db.add(
            Event(
                user_id=req.user_id,
                type="sleep",
                start_ts=start,
                end_ts=end,
                value_json={"hours": round(float(hours), 1), "quality": "synced"},
            )
        )
        count += 1
    for w in req.workouts:
        try:
            start_s = w.get("start")
            end_s = w.get("end")
            wtype = (w.get("workout_type") or "run").strip().lower()
            dur = int(w.get("duration_min", 0))
            cal = int(w.get("calories", 0))
            if not start_s or not end_s or dur <= 0:
                continue
            start = datetime.fromisoformat(start_s.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_s.replace("Z", "+00:00"))
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            if cal <= 0:
                cal = dur * 6
            db.add(
                Event(
                    user_id=req.user_id,
                    type="workout",
                    start_ts=start,
                    end_ts=end,
                    value_json={
                        "workout_type": wtype,
                        "duration_min": dur,
                        "calories": cal,
                        "intensity": "moderate",
                    },
                )
            )
            count += 1
        except Exception:
            continue
    db.commit()
    return {"success": True, "events_created": count}


# Summary --------------------------------------------------------------
@app.get("/summary/today", tags=["data"])
def today_summary(user_id: str, db: Session = Depends(get_db)):
    return _today_data(db, user_id)


@app.get("/summary/week", tags=["data"])
def week_summary(user_id: str, db: Session = Depends(get_db)):
    return _week_data(db, user_id)


def _daily_plan(db: Session, user_id: str) -> dict:
    """Combines today's meals (with macros) + activity (workouts, steps, sleep)
    + TDEE-based targets + water + suggestions. Connects food and workouts."""
    today_data = _today_data(db, user_id)
    meals = _meals_today(db, user_id)
    targets = _default_targets(db, user_id)

    # Water logged today
    today = datetime.now(timezone.utc).date()
    t0 = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    t1 = t0 + timedelta(days=1)
    water_rows = db.query(WaterLog).filter(
        WaterLog.user_id == user_id, WaterLog.ts >= t0, WaterLog.ts < t1
    ).all()
    water_drunk_ml = sum(w.amount_ml for w in water_rows)

    total_cal = sum(m.get("calories") or 0 for m in meals)
    total_p = sum(m.get("protein_g") or 0 for m in meals)
    total_c = sum(m.get("carbs_g") or 0 for m in meals)
    total_f = sum(m.get("fat_g") or 0 for m in meals)
    total_fiber = sum(m.get("fiber_g") or 0 for m in meals)
    total_sugar = sum(m.get("sugar_g") or 0 for m in meals)

    target_cal = targets["target_calories"]
    target_p = targets["protein_g"]
    target_c = targets["carbs_g"]
    target_f = targets["fat_g"]
    target_water = targets["water_ml"]

    cal_burned = today_data["calories_burned"]
    # Net calories = eaten - burned (steps contribute ~0.04 kcal/step)
    step_cal = int(today_data["steps"] * 0.04)
    net_cal = total_cal - cal_burned - step_cal
    # Remaining budget accounts for calories burned via workouts and steps
    adjusted_budget = target_cal + cal_burned + step_cal
    remaining_cal = max(0, adjusted_budget - total_cal)
    remaining_p = max(0, target_p - total_p)
    remaining_water = max(0, target_water - water_drunk_ml)

    suggestions = []
    if total_p < target_p * 0.4 and target_p > 0:
        suggestions.append(f"Protein low ({total_p}g/{target_p}g). Add chicken, eggs, or Greek yogurt to your next meal.")
    if cal_burned > 300 and total_c < 80:
        suggestions.append(f"Worked out {cal_burned} kcal — low carbs ({total_c}g). Add rice, oats or fruit to refuel.")
    if remaining_cal > 600 and len(meals) < 2:
        suggestions.append(f"Only {len(meals)} meal logged. You still have ~{remaining_cal} kcal left in your budget.")
    if total_cal > adjusted_budget:
        over = total_cal - adjusted_budget
        suggestions.append(f"Over daily budget by ~{over} kcal. A 30-min walk burns ~120–150 kcal.")
    if water_drunk_ml < target_water * 0.5:
        suggestions.append(f"Hydration low ({water_drunk_ml}ml/{target_water}ml). Drink a glass of water now.")
    if today_data["sleep_hrs"] > 0 and today_data["sleep_hrs"] < 6:
        suggestions.append("Sleep deficit detected. Poor sleep increases hunger hormones — aim for 7–9h tonight.")
    if not today_data["workouts"] and today_data["steps"] < 4000:
        suggestions.append("No workout and low steps today. Even a 20-min walk makes a difference.")
    if not suggestions:
        suggestions.append("You're on track! Stay consistent and keep logging your meals.")

    return {
        "date": today_data["date"],
        "meals": meals,
        "eaten": {
            "calories": total_cal,
            "protein_g": total_p,
            "carbs_g": total_c,
            "fat_g": total_f,
            "fiber_g": total_fiber,
            "sugar_g": total_sugar,
        },
        "burned": cal_burned,
        "step_calories": step_cal,
        "net_calories": net_cal,
        "workouts": today_data["workouts"],
        "steps": today_data["steps"],
        "sleep_hrs": today_data["sleep_hrs"],
        "water": {
            "drunk_ml": water_drunk_ml,
            "target_ml": target_water,
            "remaining_ml": remaining_water,
        },
        "targets": targets,
        "remaining": {
            "calories": remaining_cal,
            "protein_g": remaining_p,
        },
        "suggestions": suggestions[:5],
    }


@app.get("/summary/daily-plan", tags=["data"])
def daily_plan(user_id: str, db: Session = Depends(get_db)):
    """Single view: nutrition (meals + macros) + activity (workouts, steps, sleep) + goals + remaining + suggestions. Connects food with workouts for today's plan."""
    return _daily_plan(db, user_id)


# Meals ----------------------------------------------------------------
@app.post("/meal/analyze", tags=["meal"])
async def analyze_meal(
    bg: BackgroundTasks,
    image: UploadFile = File(...),
    user_id: str = Form(...),
    db: Session = Depends(get_db),
):
    image_bytes = await image.read()
    analysis = await analyze_food_image(image_bytes)

    meal = Meal(user_id=user_id, ts=datetime.now(timezone.utc), reka_json=analysis)
    db.add(meal)
    db.commit()
    db.refresh(meal)

    bg.add_task(_meal_notifications, user_id, analysis)

    return {"id": meal.id, "analysis": analysis}


@app.get("/meal/last", tags=["meal"])
def get_last_meal(user_id: str, db: Session = Depends(get_db)):
    meal = (
        db.query(Meal)
        .filter(Meal.user_id == user_id)
        .order_by(desc(Meal.ts))
        .first()
    )
    if not meal:
        return {"meal": None}
    return {
        "meal": {
            "id": meal.id,
            "ts": meal.ts.isoformat(),
            "analysis": meal.reka_json,
            "confirmed": meal.user_confirmed_json,
        }
    }


@app.put("/meal/{meal_id}/confirm", tags=["meal"])
def confirm_meal(meal_id: int, body: dict, db: Session = Depends(get_db)):
    meal = db.query(Meal).filter(Meal.id == meal_id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    meal.user_confirmed_json = body
    db.commit()
    return {"success": True}


class MealLogRequest(BaseModel):
    user_id: str
    name: str
    calories: Optional[int] = None
    protein_g: Optional[int] = None
    carbs_g: Optional[int] = None
    fat_g: Optional[int] = None
    fiber_g: Optional[int] = None
    sugar_g: Optional[int] = None


@app.post("/meal/log", tags=["meal"])
async def log_meal(req: MealLogRequest, bg: BackgroundTasks, db: Session = Depends(get_db)):
    """Log a meal by text. Always estimates calories + macros via OpenAI/Reka if not provided."""
    has_macros = any([req.protein_g, req.carbs_g, req.fat_g])
    has_calories = req.calories is not None

    if has_macros and has_calories:
        # User provided everything manually — use as-is
        analysis: dict = {
            "items": [{"name": req.name.strip(), "confidence": 1.0, "portion": "as entered"}],
            "estimated_calories": req.calories,
            "estimated_macros": {
                "protein_g": req.protein_g or 0,
                "carbs_g": req.carbs_g or 0,
                "fat_g": req.fat_g or 0,
                "fiber_g": req.fiber_g or 0,
                "sugar_g": req.sugar_g or 0,
            },
            "water_ml": None,
            "notes": "Entered manually",
            "source": "manual",
        }
    else:
        # Always call AI to estimate — OpenAI knows Chipotle, chocolate cake, etc.
        estimated = await analyze_food_text(req.name)
        if estimated.get("stub") or not estimated.get("estimated_calories"):
            # Fallback: still store what we have
            analysis = {
                "items": [{"name": req.name.strip(), "confidence": 1.0, "portion": "unknown"}],
                "estimated_calories": req.calories,
                "estimated_macros": None,
                "water_ml": None,
                "notes": "Could not estimate — check your OpenAI key",
                "source": "manual",
            }
        else:
            # Override with AI values, but let user-provided values win
            analysis = {
                "items": estimated.get("items", [{"name": req.name.strip(), "confidence": 0.9}]),
                "estimated_calories": req.calories or estimated.get("estimated_calories"),
                "estimated_macros": {
                    "protein_g": req.protein_g or (estimated.get("estimated_macros") or {}).get("protein_g", 0),
                    "carbs_g": req.carbs_g or (estimated.get("estimated_macros") or {}).get("carbs_g", 0),
                    "fat_g": req.fat_g or (estimated.get("estimated_macros") or {}).get("fat_g", 0),
                    "fiber_g": req.fiber_g or (estimated.get("estimated_macros") or {}).get("fiber_g", 0),
                    "sugar_g": req.sugar_g or (estimated.get("estimated_macros") or {}).get("sugar_g", 0),
                },
                "water_ml": estimated.get("water_ml"),
                "notes": estimated.get("notes", "AI-estimated"),
                "source": "ai_text",
            }

    meal = Meal(user_id=req.user_id, ts=datetime.now(timezone.utc), reka_json=analysis)
    db.add(meal)
    db.commit()
    db.refresh(meal)

    cal = analysis.get("estimated_calories")
    macros = analysis.get("estimated_macros") or {}
    note_parts = [f"Added: {req.name}"]
    if cal:
        note_parts.append(f"~{cal} kcal")
    if macros.get("protein_g"):
        note_parts.append(f"P {macros['protein_g']}g")
    if macros.get("carbs_g"):
        note_parts.append(f"C {macros['carbs_g']}g")

    _push(db, req.user_id, "meal_logged", "Meal logged ✅", " · ".join(note_parts))
    if cal and cal > 0:
        bg.add_task(_meal_notifications, req.user_id, analysis)

    return {"success": True, "id": meal.id, "analysis": analysis}


def _meals_today(db: Session, user_id: str):
    today = datetime.now(timezone.utc).date()
    t0 = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    t1 = t0 + timedelta(days=1)
    rows = (
        db.query(Meal)
        .filter(Meal.user_id == user_id, Meal.ts >= t0, Meal.ts < t1)
        .order_by(Meal.ts)
        .all()
    )
    out = []
    for m in rows:
        rj = m.reka_json or {}
        items = rj.get("items", [])
        # Build display name from items list
        names = [i.get("name", "") for i in items if i.get("name")]
        name = ", ".join(names[:3]) if names else "Meal"
        macros = rj.get("estimated_macros") or {}
        out.append({
            "id": m.id,
            "name": name,
            "calories": rj.get("estimated_calories"),
            "protein_g": macros.get("protein_g"),
            "carbs_g": macros.get("carbs_g"),
            "fat_g": macros.get("fat_g"),
            "fiber_g": macros.get("fiber_g"),
            "sugar_g": macros.get("sugar_g"),
            "water_ml": rj.get("water_ml"),
            "notes": rj.get("notes"),
            "ts": m.ts.isoformat(),
            "source": rj.get("source", "photo"),
            "items": items,
        })
    return out


@app.get("/meals/today", tags=["meal"])
def meals_today(user_id: str, db: Session = Depends(get_db)):
    """List all meals logged today (manual + photo) for the meal list and AI suggestions."""
    return {"meals": _meals_today(db, user_id)}


@app.delete("/meal/{meal_id}", tags=["meal"])
def delete_meal(meal_id: int, user_id: str, db: Session = Depends(get_db)):
    """Delete a meal by ID. user_id must match the record owner."""
    meal = db.query(Meal).filter(Meal.id == meal_id, Meal.user_id == user_id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    db.delete(meal)
    db.commit()
    return {"success": True, "deleted_id": meal_id}


@app.delete("/event/{event_id}", tags=["data"])
def delete_event(event_id: int, user_id: str, db: Session = Depends(get_db)):
    """Delete an event (workout, sleep, steps) by ID."""
    event = db.query(Event).filter(Event.id == event_id, Event.user_id == user_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
    return {"success": True, "deleted_id": event_id}


class WorkoutLogRequest(BaseModel):
    user_id: str
    workout_type: str
    duration_min: int
    calories: Optional[int] = None
    intensity: str = "moderate"


@app.post("/workout/log", tags=["data"])
def log_workout(req: WorkoutLogRequest, db: Session = Depends(get_db)):
    """Log a workout manually. Shows in Today and feeds AI suggestions."""
    cal = req.calories
    if cal is None:
        cal_per_min = {"run": 8, "weights": 6, "walk": 4, "cycling": 7, "yoga": 3, "hiit": 10}.get(req.workout_type.lower(), 5)
        mult = {"light": 0.7, "moderate": 1.0, "intense": 1.4}.get(req.intensity.lower(), 1.0)
        cal = int(req.duration_min * cal_per_min * mult)
    now = datetime.now(timezone.utc)
    db.add(
        Event(
            user_id=req.user_id,
            type="workout",
            start_ts=now,
            end_ts=now + timedelta(minutes=req.duration_min),
            value_json={
                "workout_type": req.workout_type.strip().lower(),
                "duration_min": req.duration_min,
                "calories": cal,
                "intensity": req.intensity.strip().lower(),
            },
        )
    )
    db.commit()
    _push(
        db, req.user_id, "workout_complete",
        "Workout logged 💪",
        f"{req.workout_type} · {req.duration_min} min (~{cal} kcal). Great job!",
    )
    return {"success": True}


# Goals ----------------------------------------------------------------
class GoalRequest(BaseModel):
    user_id: str
    goal_json: dict


@app.post("/goals", tags=["goals"])
def set_goal(req: GoalRequest, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.user_id == req.user_id).first()
    if goal:
        goal.goal_json = req.goal_json
        goal.updated_at = datetime.now(timezone.utc)
    else:
        goal = Goal(user_id=req.user_id, goal_json=req.goal_json)
        db.add(goal)
    db.commit()
    _push(
        db, req.user_id, "goal_update",
        "Goals updated 🎯",
        f"Your targets: {', '.join(f'{k}={v}' for k, v in req.goal_json.items())}",
    )
    return {"success": True, "goal": req.goal_json}


@app.get("/goals/{user_id}", tags=["goals"])
def get_goals(user_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.user_id == user_id).first()
    return {"goals": goal.goal_json if goal else None}


# User Profile ---------------------------------------------------------
class ProfileRequest(BaseModel):
    user_id: str
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None        # male | female | other
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    activity_level: Optional[str] = None  # sedentary | light | moderate | active | very_active
    goal: Optional[str] = None           # lose | maintain | gain


@app.post("/profile", tags=["profile"])
def upsert_profile(req: ProfileRequest, db: Session = Depends(get_db)):
    profile = db.query(UserProfile).filter(UserProfile.user_id == req.user_id).first()
    if not profile:
        profile = UserProfile(user_id=req.user_id)
        db.add(profile)
    for field in ["name", "age", "gender", "weight_kg", "height_cm", "activity_level", "goal"]:
        val = getattr(req, field)
        if val is not None:
            setattr(profile, field, val)
    db.commit()
    db.refresh(profile)
    tdee = _calc_tdee(profile) if profile.weight_kg else None
    _push(db, req.user_id, "goal_update", "Profile updated 🎯",
          f"Weight {profile.weight_kg}kg · Goal: {profile.goal or 'maintain'}" +
          (f" · Daily budget: {tdee['target_calories']} kcal" if tdee else ""))
    return {"success": True, "tdee": tdee}


@app.get("/profile/{user_id}", tags=["profile"])
def get_profile(user_id: str, db: Session = Depends(get_db)):
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if not profile:
        return {"profile": None, "tdee": None}
    tdee = _calc_tdee(profile) if profile.weight_kg else None
    return {
        "profile": {
            "user_id": profile.user_id,
            "name": profile.name,
            "age": profile.age,
            "gender": profile.gender,
            "weight_kg": profile.weight_kg,
            "height_cm": profile.height_cm,
            "activity_level": profile.activity_level,
            "goal": profile.goal,
        },
        "tdee": tdee,
    }


# Water Tracking -------------------------------------------------------
class WaterLogRequest(BaseModel):
    user_id: str
    amount_ml: int = 250


@app.post("/water/log", tags=["water"])
def log_water(req: WaterLogRequest, db: Session = Depends(get_db)):
    db.add(WaterLog(user_id=req.user_id, ts=datetime.now(timezone.utc), amount_ml=req.amount_ml))
    db.commit()
    # Total today
    today = datetime.now(timezone.utc).date()
    t0 = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    total = db.query(WaterLog).filter(WaterLog.user_id == req.user_id, WaterLog.ts >= t0).all()
    total_ml = sum(w.amount_ml for w in total)
    targets = _default_targets(db, req.user_id)
    pct = round(total_ml / targets["water_ml"] * 100) if targets["water_ml"] else 0
    _push(db, req.user_id, "water_logged", "Water logged 💧",
          f"Total today: {total_ml}ml / {targets['water_ml']}ml ({pct}%)")
    return {"success": True, "total_ml": total_ml}


@app.get("/water/today", tags=["water"])
def water_today(user_id: str, db: Session = Depends(get_db)):
    today = datetime.now(timezone.utc).date()
    t0 = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    rows = db.query(WaterLog).filter(WaterLog.user_id == user_id, WaterLog.ts >= t0).all()
    total_ml = sum(w.amount_ml for w in rows)
    targets = _default_targets(db, user_id)
    return {"total_ml": total_ml, "target_ml": targets["water_ml"],
            "pct": round(total_ml / targets["water_ml"] * 100) if targets["water_ml"] else 0,
            "logs": [{"amount_ml": w.amount_ml, "ts": w.ts.isoformat()} for w in rows]}


# Notifications --------------------------------------------------------
@app.get("/notifications/stream/{user_id}", tags=["notifications"])
async def notification_stream(user_id: str):
    """Server-Sent Events stream for real-time notifications."""

    async def gen():
        last_id = 0
        yield "data: {\"connected\": true}\n\n"
        while True:
            db = SessionLocal()
            try:
                rows = (
                    db.query(Notification)
                    .filter(Notification.user_id == user_id, Notification.id > last_id)
                    .order_by(Notification.created_at)
                    .all()
                )
                for n in rows:
                    last_id = n.id
                    payload = json.dumps(
                        {
                            "id": n.id,
                            "type": n.type,
                            "title": n.title,
                            "message": n.message,
                            "read": n.read,
                            "created_at": n.created_at.isoformat(),
                        }
                    )
                    yield f"data: {payload}\n\n"
            finally:
                db.close()
            await asyncio.sleep(3)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/notifications/list/{user_id}", tags=["notifications"])
def list_notifications(user_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(desc(Notification.created_at))
        .limit(30)
        .all()
    )
    return {
        "notifications": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "message": n.message,
                "read": n.read,
                "created_at": n.created_at.isoformat(),
            }
            for n in rows
        ],
        "unread_count": sum(1 for n in rows if not n.read),
    }


@app.put("/notifications/{notif_id}/read", tags=["notifications"])
def mark_read(notif_id: int, db: Session = Depends(get_db)):
    n = db.query(Notification).filter(Notification.id == notif_id).first()
    if n:
        n.read = True
        db.commit()
    return {"success": True}


@app.put("/notifications/user/{user_id}/read-all", tags=["notifications"])
def mark_all_read(user_id: str, db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == user_id, Notification.read == False
    ).update({"read": True})
    db.commit()
    return {"success": True}


# Notification delivery prefs (Twilio SMS / SendGrid email) -----------------
class NotificationPrefsRequest(BaseModel):
    user_id: str
    phone: Optional[str] = None   # E.164 e.g. +15551234567
    email: Optional[str] = None
    reminders_enabled: Optional[bool] = None
    timezone: Optional[str] = None


@app.get("/notifications/preferences/{user_id}", tags=["notifications"])
def get_notification_preferences(user_id: str, db: Session = Depends(get_db)):
    prefs = db.query(NotificationPreferences).filter(NotificationPreferences.user_id == user_id).first()
    if not prefs:
        return {"phone": None, "email": None, "reminders_enabled": False, "timezone": "UTC"}
    return {
        "phone": prefs.phone,
        "email": prefs.email,
        "reminders_enabled": prefs.reminders_enabled,
        "timezone": prefs.timezone or "UTC",
    }


@app.post("/notifications/preferences", tags=["notifications"])
def save_notification_preferences(req: NotificationPrefsRequest, db: Session = Depends(get_db)):
    prefs = db.query(NotificationPreferences).filter(NotificationPreferences.user_id == req.user_id).first()
    if not prefs:
        prefs = NotificationPreferences(user_id=req.user_id)
        db.add(prefs)
    if req.phone is not None:
        prefs.phone = req.phone.strip() or None
    if req.email is not None:
        prefs.email = req.email.strip() or None
    if req.reminders_enabled is not None:
        prefs.reminders_enabled = req.reminders_enabled
    if req.timezone is not None:
        prefs.timezone = (req.timezone or "UTC").strip()
    db.commit()
    db.refresh(prefs)
    return {"success": True, "reminders_enabled": prefs.reminders_enabled}


class TestSmsRequest(BaseModel):
    user_id: str
    phone: Optional[str] = None  # optional; if missing use prefs.phone


@app.post("/notifications/test-sms", tags=["notifications"])
async def test_sms(req: TestSmsRequest, db: Session = Depends(get_db)):
    """Send one test SMS for demo. Uses req.phone or saved preference. Returns 200 with success/error so UI can show Twilio errors."""
    phone = (req.phone or "").strip()
    if not phone:
        prefs = db.query(NotificationPreferences).filter(NotificationPreferences.user_id == req.user_id).first()
        phone = (prefs and prefs.phone) or ""
    if not phone:
        return {"success": False, "error": "Add a phone number in Profile → Reminders first"}
    body = "LifeOS demo: reminders are working! You'll get morning, lunch & sleep tips. 🧠"
    ok, msg = await asyncio.to_thread(twilio_send_sms, phone, body)
    if not ok:
        return {"success": False, "error": msg}
    return {"success": True, "message": "Test SMS sent"}


# Cron: send scheduled reminders (morning / lunch / sleep) via Twilio + SendGrid
REMINDER_MESSAGES = {
    "morning": {
        "sms": "Good morning! Log breakfast in LifeOS when you can — it helps your daily plan.",
        "subject": "Good morning from LifeOS",
        "body": "Log breakfast when you can so your daily plan stays accurate. Open LifeOS to see your targets.",
    },
    "lunch": {
        "sms": "Lunch time — log your meal in LifeOS to stay on track with calories & protein.",
        "subject": "Lunch reminder from LifeOS",
        "body": "Remember to log lunch in LifeOS. Your coach uses this to suggest dinner and workouts.",
    },
    "sleep": {
        "sms": "Wind down for sleep — aim for 8 hours. Tomorrow's plan is ready in LifeOS.",
        "subject": "Sleep reminder from LifeOS",
        "body": "Aim for 8 hours of sleep tonight. Your LifeOS plan will be ready in the morning.",
    },
}


@app.post("/cron/send-reminders", tags=["cron"])
async def cron_send_reminders(
    reminder_type: str = "auto",  # morning | lunch | sleep | auto
    db: Session = Depends(get_db),
):
    """
    Called by Render cron at 9:00, 13:00, 22:00 UTC (or pass reminder_type).
    Sends at most one SMS/email per user per type per day. Auto = infer from current UTC hour (9, 13, 22).
    """
    now = datetime.now(timezone.utc)
    hour = now.hour
    if reminder_type == "auto":
        if hour == 9:
            reminder_type = "morning"
        elif hour == 13:
            reminder_type = "lunch"
        elif hour == 22:
            reminder_type = "sleep"
        else:
            return {"sent": 0, "message": "No reminder scheduled for this hour"}
    if reminder_type not in REMINDER_MESSAGES:
        raise HTTPException(status_code=400, detail="reminder_type must be morning, lunch, sleep, or auto")

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_sent_col = {
        "morning": "last_morning_sent",
        "lunch": "last_lunch_sent",
        "sleep": "last_sleep_sent",
    }[reminder_type]

    prefs_list = (
        db.query(NotificationPreferences)
        .filter(
            NotificationPreferences.reminders_enabled == True,
            (NotificationPreferences.phone != None) | (NotificationPreferences.email != None),
        )
        .all()
    )
    msg = REMINDER_MESSAGES[reminder_type]
    sent = 0
    for prefs in prefs_list:
        last_sent = getattr(prefs, last_sent_col)
        if last_sent and last_sent >= today_start:
            continue
        user_sent = False
        if prefs.phone:
            ok, _ = await asyncio.to_thread(twilio_send_sms, prefs.phone, msg["sms"])
            if ok:
                sent += 1
                user_sent = True
        if prefs.email:
            ok, _ = await asyncio.to_thread(sendgrid_send_email, prefs.email, msg["subject"], msg["body"])
            if ok:
                sent += 1
                user_sent = True
        if user_sent:
            setattr(prefs, last_sent_col, now)
            db.commit()
    return {"sent": sent, "reminder_type": reminder_type}


# Chat -----------------------------------------------------------------
class ChatRequest(BaseModel):
    user_id: str
    message: str


@app.post("/chat", tags=["chat"])
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    if not settings.OPENAI_API_KEY:
        return {
            "reply": (
                "AI chat requires an OpenAI key. "
                "Add OPENAI_API_KEY to .env to enable full coaching. "
                "Meanwhile, try the Seed button and Meal Upload to explore other features!"
            ),
            "tools_used": [],
            "actions": [],
        }

    try:
        return await _chat_impl(req, db)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": str(e),
                "reply": f"Sorry, the assistant hit an error: {e}. Check the backend logs.",
                "tools_used": [],
                "actions": [],
            },
            headers=_cors_headers(),
        )


async def _chat_impl(req: ChatRequest, db: Session):
    import openai

    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    goal_row = db.query(Goal).filter(Goal.user_id == req.user_id).first()
    goals = goal_row.goal_json if goal_row else {
        "daily_calories": 2000,
        "protein_g": 150,
        "steps_target": 10000,
        "sleep_target": 8,
    }

    system_prompt = (
        "You are LifeOS Agent — a short, clear health coach. Today: " + datetime.now().strftime("%A %B %d, %Y") + ". "
        "User goals: " + json.dumps(goals) + ".\n\n"
        "REPLY FORMAT (strict):\n"
        "- Answer in 2–4 sentences only. No long lists, no multiple headers (no ###), no repeated numbers.\n"
        "- Structure: (1) Direct answer to their question in one sentence. (2) One line with key numbers if needed. (3) One short suggestion or tip.\n"
        "- Example for 'Can I have 4 cups ice cream?': 'Yes, it fits your remaining budget (~2174 kcal), but 4 cups is ~800 kcal and low in protein. Better: have 1–2 cups and add something high-protein (e.g. Greek yogurt) to hit your 150g protein goal.'\n"
        "- Do NOT output: 'Here is the breakdown', 'Today\'s profile', 'Remaining budget', 'Observations', 'Suggestion' as separate sections. Merge everything into one neat paragraph.\n"
        "- Never say 'data not available' — use lookup_nutrition for any food without macros. Use get_today_meals and get_daily_plan for real numbers. Never guess nutrition values."
    )

    TOOLS = [
        {
            "type": "function",
            "function": {
                "name": "get_today_summary",
                "description": "Fetch today's sleep, steps, calories burned, and workouts from the database.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_week_summary",
                "description": "Fetch 7-day health averages, trends, and workout breakdown.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web for health, nutrition, or fitness information.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"}
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_last_meal",
                "description": "Get the most recently analyzed meal with nutritional details.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_today_meals",
                "description": "Get the full list of meals logged today with calories and macros (protein, carbs, fat).",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_daily_plan",
                "description": "Get today's complete daily plan: meals eaten (total calories, protein, carbs, fat, fiber), workouts burned, net calories, water logged, targets (TDEE-based), remaining budget, and rule-based suggestions connecting food and workouts.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_user_profile",
                "description": "Get user profile: weight, height, age, activity level, goal, and calculated TDEE/nutrition targets.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "lookup_nutrition",
                "description": (
                    "Look up calories and macros (protein, carbs, fat, fiber) for any food or meal name. "
                    "Use this when a meal in the log has no macros, or when the user mentions a food and you need its nutrition. "
                    "ALWAYS call this before saying 'data not available'."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "food": {"type": "string", "description": "Food or meal name, e.g. 'Chipotle chicken bowl' or 'chocolate cake slice'"},
                        "portion": {"type": "string", "description": "Portion size if known, e.g. '1 medium slice', '1 cup'"}
                    },
                    "required": ["food"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "set_goal",
                "description": "Update health goals for the user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "goal_json": {
                            "type": "object",
                            "description": "Goals: daily_calories, protein_g, steps_target, sleep_target",
                        }
                    },
                    "required": ["goal_json"],
                },
            },
        },
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.message},
    ]
    tools_used: list[str] = []

    for _ in range(6):
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message
        messages.append(msg)

        if not msg.tool_calls:
            break

        for tc in msg.tool_calls:
            fname = tc.function.name
            fargs = json.loads(tc.function.arguments or "{}")
            tools_used.append(fname)

            if fname == "get_today_summary":
                result = _today_data(db, req.user_id)
            elif fname == "get_week_summary":
                result = _week_data(db, req.user_id)
            elif fname == "web_search":
                result = await tavily_search(fargs.get("query", ""))
            elif fname == "get_last_meal":
                m = (
                    db.query(Meal)
                    .filter(Meal.user_id == req.user_id)
                    .order_by(desc(Meal.ts))
                    .first()
                )
                result = m.reka_json if m else {"message": "No meals logged yet."}
            elif fname == "get_today_meals":
                result = {"meals": _meals_today(db, req.user_id)}
            elif fname == "lookup_nutrition":
                food = fargs.get("food", "")
                portion = fargs.get("portion", "")
                query = f"{food} {portion}".strip()
                result = await analyze_food_text(query)
            elif fname == "get_daily_plan":
                result = _daily_plan(db, req.user_id)
            elif fname == "get_user_profile":
                p = db.query(UserProfile).filter(UserProfile.user_id == req.user_id).first()
                if p:
                    result = {"weight_kg": p.weight_kg, "height_cm": p.height_cm,
                              "age": p.age, "gender": p.gender, "goal": p.goal,
                              "activity_level": p.activity_level,
                              "tdee": _calc_tdee(p) if p.weight_kg else None}
                else:
                    result = {"message": "No profile set. Ask the user to fill in their profile."}
            elif fname == "set_goal":
                gj = fargs.get("goal_json", {})
                g = db.query(Goal).filter(Goal.user_id == req.user_id).first()
                if g:
                    g.goal_json = gj
                else:
                    g = Goal(user_id=req.user_id, goal_json=gj)
                    db.add(g)
                db.commit()
                result = {"success": True, "goals": gj}
            else:
                result = {"error": f"Unknown tool: {fname}"}

            messages.append(
                {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)}
            )

    final = messages[-1]
    reply = getattr(final, "content", None) or str(final)

    # Smart action suggestions
    actions = []
    today = _today_data(db, req.user_id)
    if today["sleep_hrs"] < 6 and "sleep" in req.message.lower():
        actions.append(
            {"type": "reminder", "payload": {"text": "Set bedtime reminder tonight", "icon": "😴"}}
        )
    if not today["workouts"] and any(w in req.message.lower() for w in ["workout", "exercise", "plan"]):
        actions.append(
            {"type": "suggestion", "payload": {"text": "Log a workout when done!", "icon": "💪"}}
        )

    return {
        "reply": reply,
        "tools_used": list(dict.fromkeys(tools_used)),
        "actions": actions,
    }
