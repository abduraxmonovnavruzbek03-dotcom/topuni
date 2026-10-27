from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import University, User
from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=True)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
        jti = payload["jti"]
    except (JWTError, KeyError, TypeError, ValueError):
        raise credentials_error
    from app.models import RevokedToken
    if db.get(RevokedToken, jti):
        raise credentials_error
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise credentials_error
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dependency


def get_student_user(user: User = Depends(require_roles("student"))) -> User:
    if not user.student_profile:
        raise HTTPException(status_code=403, detail="Student profile not found")
    return user


def get_staff_university(user: User = Depends(require_roles("staff")), db: Session = Depends(get_db)) -> University:
    if not user.staff_profile:
        raise HTTPException(status_code=403, detail="University staff profile not found")
    university = db.get(University, user.staff_profile.university_id)
    if not university:
        raise HTTPException(status_code=403, detail="University is unavailable")
    return university
