from datetime import datetime, timedelta, timezone

import hmac
import smtplib
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import bearer_scheme, get_current_user
from app.email_service import send_email
from app.models import EmailOTP, RefreshToken, RevokedToken, StaffInvitation, StudentProfile, UniversityStaff, User, utcnow
from app.schemas import (
    AdminRegistration, ChangePassword, LoginRequest, MessageOut, OTPRequest, OTPVerify, RefreshRequest,
    PasswordReset, ForgotPasswordRequest, RegisterRequest, StaffAccept, TokenOut, UserOut,
)
from app.security import create_access_token, digest, generate_otp, generate_secret_token, hash_password, verify_password
from app.settings import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/admin-setup", response_model=dict[str, bool])
def admin_setup_status(db: Session = Depends(get_db)):
    available = bool(settings.admin_setup_token) and not db.scalar(select(User.id).where(User.role == "admin").limit(1))
    return {"available": available}


@router.post("/register-admin", response_model=UserOut, status_code=201)
def register_first_admin(payload: AdminRegistration, db: Session = Depends(get_db)):
    configured_token = settings.admin_setup_token
    if not configured_token or not hmac.compare_digest(payload.setup_token, configured_token):
        raise HTTPException(status_code=403, detail="Admin setup is unavailable or the setup code is invalid")
    # Serialize bootstrap requests on PostgreSQL so only one administrator can be created.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(7419286401)"))
    if db.scalar(select(User.id).where(User.role == "admin").limit(1)):
        db.rollback()
        raise HTTPException(status_code=409, detail="An administrator already exists")
    email = payload.email.lower()
    if db.scalar(select(User.id).where((User.email == email) | (User.username == payload.username)).limit(1)):
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or username is already in use")
    admin = User(
        email=email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        role="admin",
        is_active=True,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or username is already in use") from exc
    db.refresh(admin)
    return admin


def issue_otp(db: Session, email: str, purpose: str) -> str:
    now = utcnow()
    recent_requests = db.scalar(select(func.count(EmailOTP.id)).where(
        EmailOTP.email == email,
        EmailOTP.purpose == purpose,
        EmailOTP.created_at >= now - timedelta(minutes=15),
    )) or 0
    if recent_requests >= 5:
        raise HTTPException(status_code=429, detail="Too many verification code requests; try again later")
    db.query(EmailOTP).filter(
        EmailOTP.email == email, EmailOTP.purpose == purpose, EmailOTP.consumed_at.is_(None)
    ).update({EmailOTP.consumed_at: now}, synchronize_session=False)
    code = generate_otp()
    db.add(EmailOTP(
        email=email, purpose=purpose, code_hash=digest(code),
        expires_at=now + timedelta(minutes=settings.otp_expire_minutes),
    ))
    db.commit()
    return code


def find_valid_otp(db: Session, email: str, purpose: str, code: str) -> EmailOTP:
    otp = db.scalar(
        select(EmailOTP).where(
            EmailOTP.email == email,
            EmailOTP.purpose == purpose,
            EmailOTP.consumed_at.is_(None),
            EmailOTP.expires_at > utcnow(),
        ).order_by(EmailOTP.created_at.desc())
    )
    if not otp or otp.attempts >= settings.otp_max_attempts:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    otp.attempts += 1
    if otp.code_hash != digest(code):
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    db.commit()
    return otp


@router.post("/otp/request", response_model=MessageOut, status_code=202)
def request_otp(payload: OTPRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if payload.purpose == "registration" and db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email is already registered")
    if payload.purpose == "password_reset" and not db.scalar(select(User.id).where(User.email == email)):
        return {"message": "If the account exists, a verification code has been sent"}
    code = issue_otp(db, email, payload.purpose)
    try:
        send_email(email, "UniApply verification code", f"Your UniApply verification code is {code}. It expires in {settings.otp_expire_minutes} minutes.")
    except (OSError, RuntimeError, smtplib.SMTPException) as exc:
        raise HTTPException(status_code=503, detail="Email delivery failed; please try again later") from exc
    return {"message": "If the account exists, a verification code has been sent"}


@router.post("/otp/verify", response_model=MessageOut)
def verify_otp(payload: OTPVerify, db: Session = Depends(get_db)):
    otp = find_valid_otp(db, payload.email.lower(), payload.purpose, payload.code)
    otp.verified_at = utcnow()
    db.commit()
    return {"message": "Email verified"}


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    otp = db.scalar(select(EmailOTP).where(
        EmailOTP.email == email, EmailOTP.purpose == "registration",
        EmailOTP.verified_at.is_not(None), EmailOTP.consumed_at.is_(None),
        EmailOTP.expires_at > utcnow(),
    ).order_by(EmailOTP.created_at.desc()))
    if not otp:
        raise HTTPException(status_code=400, detail="Verify the email address before registering")
    if db.scalar(select(User.id).where((User.email == email) | (User.username == payload.username))):
        raise HTTPException(status_code=409, detail="Email or username is already in use")
    user = User(email=email, username=payload.username, password_hash=hash_password(payload.password), role="student")
    user.student_profile = StudentProfile(first_name=payload.first_name, last_name=payload.last_name)
    otp.consumed_at = utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenOut)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash) or not user.is_active:
        raise HTTPException(status_code=401, detail="Incorrect username or password", headers={"WWW-Authenticate": "Bearer"})
    session_id = str(uuid.uuid4())
    access_token, _, _ = create_access_token(user.id, session_id)
    refresh_token = generate_secret_token()
    db.add(RefreshToken(
        token_hash=digest(refresh_token),
        user_id=user.id,
        session_id=session_id,
        expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
    ))
    db.commit()
    return {"access_token": access_token, "refresh_token": refresh_token, "user": user}


@router.post("/refresh", response_model=TokenOut)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    now = utcnow()
    token_hash = digest(payload.refresh_token)
    refresh_session = db.scalar(select(RefreshToken).where(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked_at.is_(None),
        RefreshToken.expires_at > now,
    ))
    if not refresh_session:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user = db.get(User, refresh_session.user_id)
    if not user or not user.is_active:
        refresh_session.revoked_at = now
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    claimed = db.execute(update(RefreshToken).where(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked_at.is_(None),
        RefreshToken.expires_at > now,
    ).values(revoked_at=now).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    access_token, _, _ = create_access_token(user.id, refresh_session.session_id)
    next_refresh_token = generate_secret_token()
    db.add(RefreshToken(
        token_hash=digest(next_refresh_token),
        user_id=user.id,
        session_id=refresh_session.session_id,
        expires_at=now + timedelta(days=settings.refresh_token_expire_days),
    ))
    db.commit()
    return {"access_token": access_token, "refresh_token": next_refresh_token, "user": user}


@router.post("/logout", response_model=MessageOut)
def logout(credentials=Depends(bearer_scheme), db: Session = Depends(get_db)):
    from app.security import decode_access_token
    from jose import JWTError
    try:
        claims = decode_access_token(credentials.credentials)
        jti = claims["jti"]
        session_id = claims.get("sid")
        expires = datetime.fromtimestamp(claims["exp"], timezone.utc)
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired credentials") from exc
    if not db.get(RevokedToken, jti):
        db.add(RevokedToken(jti=jti, expires_at=expires))
    if session_id:
        db.execute(update(RefreshToken).where(
            RefreshToken.session_id == session_id,
            RefreshToken.revoked_at.is_(None),
        ).values(revoked_at=utcnow()))
    db.commit()
    return {"message": "Logged out"}


@router.get("/me", response_model=UserOut)
def current_user(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", response_model=MessageOut)
def change_password(payload: ChangePassword, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.execute(update(RefreshToken).where(
        RefreshToken.user_id == user.id,
        RefreshToken.revoked_at.is_(None),
    ).values(revoked_at=utcnow()))
    db.commit()
    return {"message": "Password updated"}


@router.post("/forgot-password", response_model=MessageOut, status_code=202)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    return request_otp(OTPRequest(email=payload.email, purpose="password_reset"), db)


@router.post("/reset-password", response_model=MessageOut)
def reset_password(payload: PasswordReset, db: Session = Depends(get_db)):
    otp = find_valid_otp(db, payload.email.lower(), "password_reset", payload.code)
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    user.password_hash = hash_password(payload.new_password)
    otp.consumed_at = utcnow()
    db.execute(update(RefreshToken).where(
        RefreshToken.user_id == user.id,
        RefreshToken.revoked_at.is_(None),
    ).values(revoked_at=utcnow()))
    db.commit()
    return {"message": "Password reset successfully"}


@router.post("/staff/accept-invitation", response_model=UserOut, status_code=201)
def accept_staff_invitation(payload: StaffAccept, db: Session = Depends(get_db)):
    invitation = db.scalar(select(StaffInvitation).where(
        StaffInvitation.token_hash == digest(payload.token),
        StaffInvitation.accepted_at.is_(None),
        StaffInvitation.expires_at > utcnow(),
    ))
    if not invitation:
        raise HTTPException(status_code=400, detail="Invalid or expired invitation")
    email = invitation.email.lower()
    if db.scalar(select(User.id).where((User.email == email) | (User.username == payload.username))):
        raise HTTPException(status_code=409, detail="Email or username is already in use")
    user = User(email=email, username=payload.username, password_hash=hash_password(payload.password), role="staff")
    university_id = invitation.university_id
    user.staff_profile = UniversityStaff(university_id=university_id)
    invitation.accepted_at = utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
