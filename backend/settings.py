from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./lifeos.db"
    OPENAI_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None
    REKA_API_KEY: Optional[str] = None
    REKA_API_URL: str = "https://api.reka.ai/v1"
    # Twilio SMS
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None  # E.164, e.g. +1234567890
    # SendGrid email (optional)
    SENDGRID_API_KEY: Optional[str] = None
    SENDGRID_FROM_EMAIL: str = "noreply@lifeos.app"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
