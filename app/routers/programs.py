from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_staff_university
from app.models import Program, University
from app.schemas import ProgramCreate, ProgramOut, ProgramUpdate

router = APIRouter(prefix="/programs", tags=["Programs"])


@router.post("", response_model=ProgramOut, status_code=201)
def create_program(payload: ProgramCreate, university: University = Depends(get_staff_university), db: Session = Depends(get_db)):
    program = Program(university_id=university.id, **payload.model_dump())
    db.add(program)
    db.commit()
    db.refresh(program)
    return program


@router.get("", response_model=list[ProgramOut])
def list_programs(university_id: int | None = None, subject: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Program).join(University).where(Program.is_active.is_(True), University.is_approved.is_(True))
    if university_id is not None:
        stmt = stmt.where(Program.university_id == university_id)
    if subject:
        stmt = stmt.where(Program.subject.ilike(f"%{subject}%"))
    return db.scalars(stmt.order_by(Program.name)).all()


@router.get("/{program_id}", response_model=ProgramOut)
def get_program(program_id: int, db: Session = Depends(get_db)):
    program = db.get(Program, program_id)
    if not program or not program.is_active or not program.university.is_approved:
        raise HTTPException(status_code=404, detail="Program not found")
    return program


@router.patch("/{program_id}", response_model=ProgramOut)
def update_program(program_id: int, payload: ProgramUpdate, university: University = Depends(get_staff_university), db: Session = Depends(get_db)):
    program = db.get(Program, program_id)
    if not program or program.university_id != university.id:
        raise HTTPException(status_code=404, detail="Program not found")
    changes = payload.model_dump(exclude_unset=True)
    non_nullable = ("name", "degree", "subject", "language", "tuition", "currency", "intake", "requirements", "description", "is_active")
    if any(changes.get(key) is None for key in non_nullable if key in changes):
        raise HTTPException(status_code=422, detail="Program fields cannot be null")
    for key, value in changes.items():
        setattr(program, key, value)
    db.commit()
    db.refresh(program)
    return program


@router.delete("/{program_id}", status_code=204)
def delete_program(program_id: int, university: University = Depends(get_staff_university), db: Session = Depends(get_db)):
    program = db.get(Program, program_id)
    if not program or program.university_id != university.id:
        raise HTTPException(status_code=404, detail="Program not found")
    db.delete(program)
    db.commit()
