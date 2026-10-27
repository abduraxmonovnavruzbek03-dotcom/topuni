from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_staff_university
from app.models import University
from app.schemas import UniversityOut, UniversityUpdate

router = APIRouter(prefix="/universities", tags=["Universities"])


@router.get("", response_model=list[UniversityOut])
def list_universities(q: str | None = Query(default=None, max_length=100), country: str | None = None, db: Session = Depends(get_db)):
    stmt = select(University).where(University.is_approved.is_(True))
    if q:
        stmt = stmt.where(University.name.ilike(f"%{q}%"))
    if country:
        stmt = stmt.where(University.country.ilike(country))
    return db.scalars(stmt.order_by(University.name)).all()


@router.get("/{university_id}", response_model=UniversityOut)
def get_university(university_id: int, db: Session = Depends(get_db)):
    university = db.get(University, university_id)
    if not university or not university.is_approved:
        raise HTTPException(status_code=404, detail="University not found")
    return university


@router.patch("/me", response_model=UniversityOut)
def update_own_university(payload: UniversityUpdate, university: University = Depends(get_staff_university), db: Session = Depends(get_db)):
    changes = payload.model_dump(exclude_unset=True)
    if any(changes.get(key) is None for key in ("name", "country", "city", "contact_email") if key in changes):
        raise HTTPException(status_code=422, detail="Name, country, city, and contact email cannot be null")
    for key, value in changes.items():
        setattr(university, key, value)
    db.commit()
    db.refresh(university)
    return university
