from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import engine
from app.routers import admin, applications, auth, documents, notifications, programs, students, universities
from app.schemas import HealthOut

app = FastAPI(
    title="UniApply API",
    description="University application platform for Uzbekistan and international applicants. Eligibility estimates are informational and do not guarantee admission.",
    version="1.0.0",
    openapi_tags=[
        {"name": "Authentication", "description": "Email verification, student registration, login, and account security."},
        {"name": "Students", "description": "Student profile and achievement management."},
        {"name": "Universities", "description": "Public approved university directory and staff self-service."},
        {"name": "Programs", "description": "University program catalog and management."},
        {"name": "Applications", "description": "Student applications, university review, and review statistics."},
        {"name": "Documents", "description": "Private application document upload and verification."},
        {"name": "Notifications", "description": "Private user notifications."},
        {"name": "Administration", "description": "Administrative user, university, invitation, and statistics operations."},
    ],
)

for router in (
    auth.router,
    students.router,
    universities.router,
    programs.router,
    applications.router,
    documents.router,
    notifications.router,
    admin.router,
):
    app.include_router(router)


@app.get("/health", tags=["Health"], summary="Liveness check", response_model=HealthOut)
def health():
    return {"status": "ok"}


@app.get("/ready", tags=["Health"], summary="Database readiness check", response_model=HealthOut)
def ready():
    try:
        with Session(engine) as db:
            db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ready", "database": "ok"}
