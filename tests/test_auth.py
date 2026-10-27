import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SECRET_KEY", "test-secret-key-only-for-local-tests-123456")

from app.database import Base, get_db
from app.main import app
from app.models import User
from app.security import verify_password
from app.settings import settings


@pytest.fixture()
def client(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    sent = []
    monkeypatch.setattr("app.routers.auth.send_email", lambda to, subject, body: sent.append((to, subject, body)))
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client, TestingSession, sent
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_email_otp_registration_login_and_bearer_auth(client):
    http, sessions, sent = client
    response = http.post("/auth/otp/request", json={"email": "student@example.com", "purpose": "registration"})
    assert response.status_code == 202
    code = sent[-1][2].split("is ")[1].split(".")[0]
    response = http.post("/auth/otp/verify", json={"email": "student@example.com", "code": code, "purpose": "registration"})
    assert response.status_code == 200

    response = http.post("/auth/register", json={
        "email": "student@example.com",
        "username": "student_one",
        "password": "strong-password-123",
        "first_name": "Amina",
        "last_name": "Student",
        "role": "admin",
    })
    assert response.status_code == 201
    assert response.json()["role"] == "student"
    with sessions() as db:
        user = db.query(User).filter_by(username="student_one").one()
        assert verify_password("strong-password-123", user.password_hash)

    response = http.post("/auth/login", json={"username": "student_one", "password": "strong-password-123"})
    assert response.status_code == 200
    token = response.json()["access_token"]
    current = http.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert current.status_code == 200
    assert current.json()["email"] == "student@example.com"


def test_otp_attempt_limit_and_registration_requires_verification(client):
    http, _, sent = client
    assert http.post("/auth/register", json={
        "email": "student@example.com", "username": "student_one",
        "password": "strong-password", "first_name": "A", "last_name": "B",
    }).status_code == 400
    assert http.post("/auth/otp/request", json={"email": "student@example.com", "purpose": "registration"}).status_code == 202
    issued_code = sent[-1][2].split("is ")[1].split(".")[0]
    invalid_code = "000000" if issued_code != "000000" else "000001"
    for _ in range(5):
        response = http.post("/auth/otp/verify", json={"email": "student@example.com", "code": invalid_code})
        assert response.status_code == 400
    assert http.post("/auth/otp/verify", json={"email": "student@example.com", "code": invalid_code}).status_code == 400


def test_logout_revokes_access_token(client):
    http, _, sent = client
    http.post("/auth/otp/request", json={"email": "logout@example.com", "purpose": "registration"})
    code = sent[-1][2].split("is ")[1].split(".")[0]
    http.post("/auth/otp/verify", json={"email": "logout@example.com", "code": code})
    http.post("/auth/register", json={
        "email": "logout@example.com", "username": "logout_user",
        "password": "strong-password", "first_name": "A", "last_name": "B",
    })
    token = http.post("/auth/login", json={"username": "logout_user", "password": "strong-password"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert http.post("/auth/logout", headers=headers).status_code == 200
    assert http.get("/auth/me", headers=headers).status_code == 401


def test_forgot_and_reset_password(client):
    http, _, sent = client
    http.post("/auth/otp/request", json={"email": "reset@example.com", "purpose": "registration"})
    code = sent[-1][2].split("is ")[1].split(".")[0]
    http.post("/auth/otp/verify", json={"email": "reset@example.com", "code": code})
    http.post("/auth/register", json={
        "email": "reset@example.com", "username": "reset_user",
        "password": "original-password", "first_name": "A", "last_name": "B",
    })

    response = http.post("/auth/forgot-password", json={"email": "reset@example.com"})
    assert response.status_code == 202
    reset_code = sent[-1][2].split("is ")[1].split(".")[0]
    response = http.post("/auth/reset-password", json={
        "email": "reset@example.com",
        "code": reset_code,
        "new_password": "replacement-password",
    })
    assert response.status_code == 200
    assert http.post("/auth/login", json={
        "username": "reset_user", "password": "replacement-password",
    }).status_code == 200


def test_first_admin_setup_is_secret_protected_and_one_time(client, monkeypatch):
    http, sessions, _ = client
    monkeypatch.setattr(settings, "admin_setup_token", "this-is-a-test-setup-token-with-more-than-32-chars")
    assert http.get("/auth/admin-setup").json() == {"available": True}
    payload = {
        "setup_token": "this-is-a-test-setup-token-with-more-than-32-chars",
        "email": "admin@example.com",
        "username": "first_admin",
        "password": "admin-password-long-enough",
        "first_name": "Platform",
        "last_name": "Admin",
    }
    response = http.post("/auth/register-admin", json={**payload, "setup_token": "incorrect-setup-token-value-long-enough"})
    assert response.status_code == 403
    assert http.get("/auth/admin-setup").json() == {"available": True}

    response = http.post("/auth/register-admin", json=payload)
    assert response.status_code == 201
    assert response.json()["role"] == "admin"
    assert "password_hash" not in response.json()
    assert http.get("/auth/admin-setup").json() == {"available": False}
    assert http.post("/auth/register-admin", json={**payload, "email": "second@example.com", "username": "second_admin"}).status_code == 409
    assert http.post("/auth/login", json={"username": "first_admin", "password": payload["password"]}).status_code == 200
    with sessions() as db:
        assert db.query(User).filter_by(role="admin").count() == 1
