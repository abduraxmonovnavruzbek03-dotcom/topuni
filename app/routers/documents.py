from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_student_user
from app.models import Application, ApplicationDocument, User
from app.schemas import DocumentOut, DocumentVerify
from app.settings import settings

router = APIRouter(prefix="/documents", tags=["Documents"])
ALLOWED_TYPES = {
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
}


def get_authorized_document(db: Session, document_id: int, user: User) -> ApplicationDocument:
    document = db.get(ApplicationDocument, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    application = document.application
    allowed = user.role == "admin"
    if user.role == "student":
        allowed = bool(user.student_profile and application.student_id == user.student_profile.id)
    elif user.role == "staff":
        allowed = bool(
            application.status != "draft"
            and user.staff_profile
            and application.program.university_id == user.staff_profile.university_id
        )
    if not allowed:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.post("/applications/{application_id}", response_model=DocumentOut, status_code=201)
async def upload_document(
    application_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_student_user),
    db: Session = Depends(get_db),
):
    application = db.get(Application, application_id)
    if not application or application.student_id != user.student_profile.id:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.status not in {"draft", "information_requested"}:
        raise HTTPException(status_code=409, detail="Documents can only be added to draft or information-requested applications")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_TYPES or file.content_type not in ALLOWED_TYPES[suffix]:
        raise HTTPException(status_code=415, detail="Unsupported document type")
    max_size = settings.max_upload_size_mb * 1024 * 1024
    storage_name = uuid4().hex
    target_dir = Path(settings.upload_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / storage_name
    size = 0
    prefix = bytearray()
    completed = False
    try:
        with target_path.open("wb") as output:
            while chunk := await file.read(64 * 1024):
                size += len(chunk)
                if size > max_size:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_size_mb} MB limit")
                if len(prefix) < 16:
                    prefix.extend(chunk[:16 - len(prefix)])
                output.write(chunk)
        signatures = {
            ".pdf": bytes(prefix).startswith(b"%PDF-"),
            ".png": bytes(prefix).startswith(b"\x89PNG\r\n\x1a\n"),
            ".jpg": bytes(prefix).startswith(b"\xff\xd8\xff"),
            ".jpeg": bytes(prefix).startswith(b"\xff\xd8\xff"),
            ".docx": bytes(prefix).startswith(b"PK\x03\x04"),
        }
        if not signatures[suffix]:
            raise HTTPException(status_code=415, detail="File contents do not match the declared document type")
        if size == 0:
            raise HTTPException(status_code=400, detail="Empty files are not allowed")
        completed = True
    finally:
        await file.close()
        if not completed:
            target_path.unlink(missing_ok=True)
    document = ApplicationDocument(
        application_id=application.id,
        filename=Path(file.filename or "document").name[:255],
        storage_name=storage_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/applications/{application_id}", response_model=list[DocumentOut])
def list_documents(application_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    application = db.get(Application, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role == "student":
        allowed = bool(user.student_profile and application.student_id == user.student_profile.id)
    elif user.role == "staff":
        allowed = bool(
            application.status != "draft"
            and user.staff_profile
            and application.program.university_id == user.staff_profile.university_id
        )
    else:
        allowed = user.role == "admin"
    if not allowed:
        raise HTTPException(status_code=404, detail="Application not found")
    return db.scalars(select(ApplicationDocument).where(ApplicationDocument.application_id == application_id).order_by(ApplicationDocument.created_at)).all()


@router.get("/{document_id}/download")
def download_document(document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    document = get_authorized_document(db, document_id, user)
    path = Path(settings.upload_dir).resolve() / document.storage_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Document file is unavailable")
    return FileResponse(path, media_type=document.content_type, filename=document.filename)


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: int, user: User = Depends(get_student_user), db: Session = Depends(get_db)):
    document = get_authorized_document(db, document_id, user)
    if document.application.student_id != user.student_profile.id:
        raise HTTPException(status_code=404, detail="Document not found")
    path = Path(settings.upload_dir).resolve() / document.storage_name
    db.delete(document)
    db.commit()
    path.unlink(missing_ok=True)


@router.patch("/{document_id}/verification", response_model=DocumentOut)
def verify_document(
    document_id: int,
    payload: DocumentVerify,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in {"staff", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    document = get_authorized_document(db, document_id, user)
    document.is_verified = payload.is_verified
    document.verified_by = user.id if payload.is_verified else None
    db.commit()
    db.refresh(document)
    return document
