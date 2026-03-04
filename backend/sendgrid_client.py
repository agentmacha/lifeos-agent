"""Send email via SendGrid. Stub if key missing."""
from typing import Optional

from settings import settings


def send_email(to_email: str, subject: str, body_plain: str, body_html: Optional[str] = None) -> tuple[bool, str]:
    """Send email. Returns (success, message)."""
    if not settings.SENDGRID_API_KEY:
        return False, "SendGrid not configured (missing SENDGRID_API_KEY)"

    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Email, To, Content

        message = Mail(
            from_email=Email(settings.SENDGRID_FROM_EMAIL, "LifeOS"),
            to_emails=To(to_email),
            subject=subject,
            plain_text_content=Content("text/plain", body_plain),
        )
        if body_html:
            message.add_content(Content("text/html", body_html))

        sg = SendGridAPIClient(settings.SENDGRID_API_KEY)
        sg.send(message)
        return True, "sent"
    except Exception as e:
        return False, str(e)
