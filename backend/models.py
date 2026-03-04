from sqlalchemy import Column, Float, Integer, String, DateTime, Boolean, Text, JSON
from sqlalchemy.sql import func
from database import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    type = Column(String, nullable=False)  # sleep | steps | workout | screen_time | goal_note
    start_ts = Column(DateTime(timezone=True), nullable=False)
    end_ts = Column(DateTime(timezone=True), nullable=True)
    value_json = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Meal(Base):
    __tablename__ = "meals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    ts = Column(DateTime(timezone=True), nullable=False)
    reka_json = Column(JSON)
    user_confirmed_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Goal(Base):
    __tablename__ = "goals"

    user_id = Column(String, primary_key=True)
    goal_json = Column(JSON)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id = Column(String, primary_key=True)
    name = Column(String, nullable=True)
    age = Column(Integer, nullable=True)
    gender = Column(String, nullable=True)          # male | female | other
    weight_kg = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    activity_level = Column(String, nullable=True)  # sedentary | light | moderate | active | very_active
    goal = Column(String, nullable=True)            # lose | maintain | gain
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WaterLog(Base):
    __tablename__ = "water_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    ts = Column(DateTime(timezone=True), nullable=False)
    amount_ml = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class NotificationPreferences(Base):
    """Per-user: phone/email for Twilio/SendGrid, and last-sent dates to cap reminders."""
    __tablename__ = "notification_preferences"

    user_id = Column(String, primary_key=True)
    phone = Column(String, nullable=True)   # E.164 for Twilio
    email = Column(String, nullable=True)
    reminders_enabled = Column(Boolean, default=False, nullable=False)
    timezone = Column(String, default="UTC", nullable=False)  # e.g. America/Los_Angeles
    last_morning_sent = Column(DateTime(timezone=True), nullable=True)  # date of last morning reminder
    last_lunch_sent = Column(DateTime(timezone=True), nullable=True)
    last_sleep_sent = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# Keep a note: WaterLog and UserProfile also use JSON columns implicitly via Float/String types.
# No JSONB anywhere — all tables are compatible with SQLite and PostgreSQL.
