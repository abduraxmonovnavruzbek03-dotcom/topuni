from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_student_user
from app.models import Achievement, StudentProfile, User
from app.schemas import AchievementCreate, AchievementOut, AchievementUpdate, StudentProfileOut, StudentProfileUpdate

router = APIRouter(prefix="/students", tags=["Students"])


@router.get("/me", response_model=StudentProfileOut)
def get_profile(user: User = Depends(get_student_user)):
    return user.student_profile


@router.patch("/me", response_model=StudentProfileOut)
def update_profile(payload: StudentProfileUpdate, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    profile = user.student_profile
    changes = payload.model_dump(exclude_unset=True)
    if any(changes.get(key) is None for key in ("first_name", "last_name", "country") if key in changes):
        raise HTTPException(status_code=422, detail="Name and country fields cannot be null")
    for key, value in changes.items():
        setattr(profile, key, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/me/achievements", response_model=list[AchievementOut])
def list_achievements(user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    return db.scalars(select(Achievement).where(Achievement.student_id == user.student_profile.id).order_by(Achievement.id)).all()


@router.post("/me/achievements", response_model=AchievementOut, status_code=201)
def create_achievement(payload: AchievementCreate, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    achievement = Achievement(student_id=user.student_profile.id, **payload.model_dump())
    db.add(achievement)
    db.commit()
    db.refresh(achievement)
    return achievement


@router.patch("/me/achievements/{achievement_id}", response_model=AchievementOut)
def update_achievement(achievement_id: int, payload: AchievementUpdate, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    achievement = db.get(Achievement, achievement_id)
    if not achievement or achievement.student_id != user.student_profile.id:
        raise HTTPException(status_code=404, detail="Achievement not found")
    changes = payload.model_dump(exclude_unset=True)
    if any(changes.get(key) is None for key in ("category", "title") if key in changes):
        raise HTTPException(status_code=422, detail="Achievement category and title cannot be null")
    for key, value in changes.items():
        setattr(achievement, key, value)
    db.commit()
    db.refresh(achievement)
    return achievement


@router.delete("/me/achievements/{achievement_id}", status_code=204)
def delete_achievement(achievement_id: int, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    achievement = db.get(Achievement, achievement_id)
    if not achievement or achievement.student_id != user.student_profile.id:
        raise HTTPException(status_code=404, detail="Achievement not found")
    db.delete(achievement)
    db.commit()
