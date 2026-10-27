import smtplib
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.email_service import send_email
from app.models import Application, Program, StaffInvitation, University, User, utcnow
from app.schemas import AdminStats, AdminUserUpdate, MessageOut, StaffInvite, UniversityCreate, UniversityDecision, UniversityOut, UserOut
from app.security import digest, generate_secret_token
from app.settings import settings

router = APIRouter(prefix="/admin", tags=["Administration"], dependencies=[Depends(require_roles("admin"))])


@router.get("/users", response_model=list[UserOut])
def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    if skip < 0 or not 1 <= limit <= 200:
        raise HTTPException(status_code=422, detail="skip must be non-negative and limit must be between 1 and 200")
    return db.scalars(select(User).order_by(User.id).offset(skip).limit(limit)).all()


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: AdminUserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_roles("admin"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="Administrators cannot deactivate their own account")
    user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user


@router.post("/universities", response_model=UniversityOut, status_code=201)
def create_university(payload: UniversityCreate, db: Session = Depends(get_db)):
    university = University(**payload.model_dump(), is_approved=False)
    db.add(university)
    db.commit()
    db.refresh(university)
    return university


@router.get("/universities/pending", response_model=list[UniversityOut])
def pending_universities(db: Session = Depends(get_db)):
    return db.scalars(select(University).where(University.review_status == "pending").order_by(University.created_at)).all()


@router.post("/universities/{university_id}/decision", response_model=UniversityOut)
def decide_university(university_id: int, payload: UniversityDecision, db: Session = Depends(get_db)):
    university = db.get(University, university_id)
    if not university:
        raise HTTPException(status_code=404, detail="University not found")
    university.is_approved = payload.decision == "approve"
    university.review_status = "approved" if university.is_approved else "rejected"
    db.commit()
    db.refresh(university)
    return university


@router.post("/staff-invitations", response_model=MessageOut, status_code=201)
def invite_staff(payload: StaffInvite, db: Session = Depends(get_db)):
    university = db.get(University, payload.university_id)
    if not university:
        raise HTTPException(status_code=404, detail="University not found")
    email = payload.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already belongs to a registered user")
    token = generate_secret_token()
    invitation = StaffInvitation(
        email=email,
        university_id=university.id,
        token_hash=digest(token),
        expires_at=utcnow() + timedelta(days=7),
    )
    db.add(invitation)
    db.commit()
    try:
        send_email(email, "UniApply university staff invitation", f"Use this one-time invitation token to register as staff for {university.name}: {token}\nThe invitation expires in 7 days.")
    except (OSError, RuntimeError, smtplib.SMTPException) as exc:
        db.delete(invitation)
        db.commit()
        raise HTTPException(status_code=503, detail="Invitation email delivery failed") from exc
    return {"message": "Staff invitation sent"}


@router.get("/statistics", response_model=AdminStats)
def statistics(db: Session = Depends(get_db)):
    count = lambda model, *conditions: db.scalar(select(func.count()).select_from(model).where(*conditions)) or 0
    return {
        "users": count(User),
        "students": count(User, User.role == "student"),
        "staff": count(User, User.role == "staff"),
        "universities": count(University),
        "pending_universities": count(University, University.review_status == "pending"),
        "programs": count(Program),
        "applications": count(Application),
    }
