"""
Email sender for the family connection mode (FR-15, implementation plan section 9).

EMAIL_BACKEND=console prints alerts to the server log (development/demo).
EMAIL_BACKEND=smtp sends real mail through the configured SMTP server.
"""
import smtplib
from email.mime.text import MIMEText

from config import Config


def send_family_alert(family_email, user_full_name, inactive_hours):
    subject = "MemorAid — Check-in notice"
    body = (
        f"Hello,\n\n"
        f"This is a gentle notice from MemorAid.\n\n"
        f"{user_full_name} has not completed their morning check-in for more "
        f"than {inactive_hours} hours. You may want to give them a call or "
        f"send a kind message.\n\n"
        f"MemorAid is a memory-support tool and not a medical service. If you "
        f"have immediate concerns, please contact your local healthcare "
        f"provider.\n\n"
        f"— The MemorAid Team"
    )
    if Config.EMAIL_BACKEND != "smtp":
        print(
            f"[MemorAid][console-email] TO: {family_email} | SUBJ: {subject}\n{body}"
        )
        return True

    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = Config.EMAIL_FROM
        msg["To"] = family_email
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=15) as server:
            server.starttls()
            if Config.SMTP_USER:
                server.login(Config.SMTP_USER, Config.SMTP_PASS)
            server.sendmail(Config.EMAIL_FROM, [family_email], msg.as_string())
        return True
    except Exception as exc:  # pragma: no cover - network path
        print(f"[MemorAid] family alert email failed: {exc}")
        return False
