import smtplib
from email.message import EmailMessage

from app.settings import settings


def send_email(to: str, subject: str, body: str) -> None:
    if not settings.smtp_username or not settings.smtp_password or not settings.email_from:
        raise RuntimeError("SMTP credentials are not configured")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.email_from
    message["To"] = to
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)
