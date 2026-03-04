"""Send SMS via Twilio. Stub if keys missing."""
from settings import settings


def send_sms(to_phone: str, body: str) -> tuple[bool, str]:
    """
    Send SMS to E.164 number. Returns (success, message).
    to_phone: e.g. +15551234567
    """
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN or not settings.TWILIO_PHONE_NUMBER:
        return False, "Twilio not configured (missing env vars)"

    try:
        from twilio.rest import Client
    except ImportError:
        return False, "Twilio package not installed. In the backend folder run: pip install twilio"

    try:
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        msg = client.messages.create(
            body=body[:1600],  # SMS limit
            from_=settings.TWILIO_PHONE_NUMBER,
            to=to_phone,
        )
        return True, str(msg.sid) if getattr(msg, "sid", None) else "sent"
    except Exception as e:
        return False, str(e)
