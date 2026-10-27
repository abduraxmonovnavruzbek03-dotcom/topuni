from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_staff_university, get_student_user
from app.models import Achievement, Application, ApplicationReview, Notification, Program, StudentProfile, User, utcnow
from app.schemas import ApplicationCreate, ApplicationOut, ApplicationUpdate, ReviewAction, ReviewOut, ReviewStats

router = APIRouter(prefix="/applications", tags=["Applications"])

ELIGIBILITY_NOTE = "This eligibility estimate is informational only and does not guarantee admission."


def assess_eligibility(db: Session, student_id: int, program: Program) -> dict:
    achievements = db.scalars(select(Achievement).where(Achievement.student_id == student_id)).all()
    scores: dict[str, float] = {}
    for item in achievements:
        if item.score is not None:
            category = item.category.strip().lower()
            scores[category] = max(scores.get(category, float("-inf")), item.score)
    results = {}
    for requirement, threshold in (program.requirements or {}).items():
        key = requirement.lower()
        score = scores.get(key)
        results[requirement] = {
            "required": threshold,
            "student_score": score,
            "meets_requirement": score is not None and score >= threshold,
        }
    return {
        "eligible": all(result["meets_requirement"] for result in results.values()),
        "requirements": results,
        "disclaimer": ELIGIBILITY_NOTE,
    }


def create_notification(db: Session, user_id: int, title: str, message: str) -> None:
    db.add(Notification(user_id=user_id, title=title, message=message))


def owned_application(db: Session, application_id: int, student_id: int) -> Application:
    application = db.get(Application, application_id)
    if not application or application.student_id != student_id:
        raise HTTPException(status_code=404, detail="Application not found")
    return application


@router.post("", response_model=ApplicationOut, status_code=201)
def create_application(payload: ApplicationCreate, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    program = db.get(Program, payload.program_id)
    if not program or not program.is_active or not program.university.is_approved:
        raise HTTPException(status_code=404, detail="Program not found")
    if payload.intake != program.intake:
        raise HTTPException(status_code=422, detail="Application intake must match the program's configured intake")
    application = Application(
        student_id=user.student_profile.id,
        program_id=program.id,
        intake=payload.intake,
        personal_statement=payload.personal_statement,
        status="draft",
        eligibility=assess_eligibility(db, user.student_profile.id, program),
    )
    db.add(application)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An application for this program and intake already exists") from exc
    db.refresh(application)
    return application


@router.get("", response_model=list[ApplicationOut])
def list_my_applications(user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    return db.scalars(select(Application).where(Application.student_id == user.student_profile.id).order_by(Application.created_at.desc())).all()


@router.get("/reviews/statistics", response_model=ReviewStats)
def review_statistics(university=Depends(get_staff_university), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Application.status, func.count(Application.id))
        .join(Program, Program.id == Application.program_id)
        .where(Program.university_id == university.id)
        .group_by(Application.status)
    ).all()
    by_status = {status: count for status, count in rows}
    return {"total": sum(by_status.values()), "by_status": by_status}


@router.get("/review-queue", response_model=list[ApplicationOut])
def review_queue(
    status_filter: str | None = Query(default=None, alias="status"),
    university=Depends(get_staff_university),
    db: Session = Depends(get_db),
):
    stmt = select(Application).join(Program).where(
        Program.university_id == university.id,
        Application.status.in_({"submitted", "under_review", "information_requested"}),
    )
    if status_filter:
        if status_filter not in {"submitted", "under_review", "information_requested"}:
            raise HTTPException(status_code=422, detail="Review queue status must be submitted, under_review, or information_requested")
        stmt = stmt.where(Application.status == status_filter)
    return db.scalars(stmt.order_by(Application.submitted_at)).all()


@router.get("/{application_id}", response_model=ApplicationOut)
def get_application(application_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    application = db.get(Application, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role == "student":
        if not user.student_profile or application.student_id != user.student_profile.id:
            raise HTTPException(status_code=404, detail="Application not found")
    elif user.role == "staff":
        if application.status == "draft" or not user.staff_profile or application.program.university_id != user.staff_profile.university_id:
            raise HTTPException(status_code=404, detail="Application not found")
    elif user.role != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return application


@router.patch("/{application_id}", response_model=ApplicationOut)
def update_application(application_id: int, payload: ApplicationUpdate, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user.student_profile.id)
    if application.status not in {"draft", "information_requested"}:
        raise HTTPException(status_code=409, detail="Only draft or information-requested applications can be edited")
    application.personal_statement = payload.personal_statement
    db.commit()
    db.refresh(application)
    return application


@router.post("/{application_id}/submit", response_model=ApplicationOut)
def submit_application(application_id: int, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user.student_profile.id)
    if application.status not in {"draft", "information_requested"}:
        raise HTTPException(status_code=409, detail="Application cannot be submitted from its current status")
    if not application.personal_statement.strip():
        raise HTTPException(status_code=400, detail="A personal statement is required before submission")
    old_status = application.status
    application.status = "submitted"
    application.submitted_at = utcnow()
    application.eligibility = assess_eligibility(db, user.student_profile.id, application.program)
    for staff in application.program.university.staff:
        create_notification(db, staff.user_id, "New application", f"A student submitted an application for {application.program.name}.")
    db.add(ApplicationReview(application_id=application.id, actor_id=user.id, action="submit", from_status=old_status, to_status="submitted"))
    db.commit()
    db.refresh(application)
    return application


@router.post("/{application_id}/withdraw", response_model=ApplicationOut)
def withdraw_application(application_id: int, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user.student_profile.id)
    if application.status not in {"draft", "submitted", "under_review", "information_requested"}:
        raise HTTPException(status_code=409, detail="Application cannot be withdrawn from its current status")
    old_status = application.status
    application.status = "withdrawn"
    db.add(ApplicationReview(application_id=application.id, actor_id=user.id, action="withdraw", from_status=old_status, to_status="withdrawn"))
    db.commit()
    db.refresh(application)
    return application


@router.post("/{application_id}/review", response_model=ApplicationOut)
def review_application(application_id: int, payload: ReviewAction, reviewer: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if reviewer.role not in {"staff", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    application = db.get(Application, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if reviewer.role == "staff" and (not reviewer.staff_profile or application.program.university_id != reviewer.staff_profile.university_id):
        raise HTTPException(status_code=404, detail="Application not found")
    transitions = {
        ("submitted", "start_review"): "under_review",
        ("under_review", "accept"): "accepted",
        ("under_review", "reject"): "rejected",
        ("under_review", "request_information"): "information_requested",
        ("submitted", "accept"): "accepted",
        ("submitted", "reject"): "rejected",
        ("submitted", "request_information"): "information_requested",
    }
    next_status = transitions.get((application.status, payload.action))
    if not next_status:
        raise HTTPException(status_code=409, detail=f"Action '{payload.action}' is not allowed from status '{application.status}'")
    old_status = application.status
    application.status = next_status
    db.add(ApplicationReview(
        application_id=application.id, actor_id=reviewer.id, action=payload.action,
        from_status=old_status, to_status=next_status, comment=payload.comment,
    ))
    create_notification(db, application.student.user_id, "Application status updated", f"Your application for {application.program.name} is now {next_status}.")
    db.commit()
    db.refresh(application)
    return application


@router.get("/{application_id}/reviews", response_model=list[ReviewOut])
def list_reviews(application_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    application = db.get(Application, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role == "student" and (not user.student_profile or application.student_id != user.student_profile.id):
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role == "staff" and (not user.staff_profile or application.program.university_id != user.staff_profile.university_id):
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role == "staff" and application.status == "draft":
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role not in {"student", "staff", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return db.scalars(select(ApplicationReview).where(ApplicationReview.application_id == application_id).order_by(ApplicationReview.created_at)).all()
