from sqlalchemy import select

from app.database import SessionLocal
from app.models import User
from app.security import hash_password
from app.settings import settings


def main() -> None:
    email = settings.initial_admin_email.strip().lower()
    username = settings.initial_admin_username.strip()
    password = settings.initial_admin_password
    if not email or not username or not password:
        raise SystemExit("Set INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_USERNAME, and INITIAL_ADMIN_PASSWORD in .env")
    if len(password) < 12:
        raise SystemExit("INITIAL_ADMIN_PASSWORD must be at least 12 characters")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.role == "admin")):
            raise SystemExit("An administrator already exists; bootstrap is one-time only")
        if db.scalar(select(User.id).where((User.email == email) | (User.username == username))):
            raise SystemExit("The configured administrator email or username is already in use")
        db.add(User(
            email=email,
            username=username,
            password_hash=hash_password(password),
            role="admin",
            is_active=True,
        ))
        db.commit()
    print(f"Initial administrator '{username}' created.")


if __name__ == "__main__":
    main()
