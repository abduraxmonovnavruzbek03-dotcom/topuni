from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class OTPRequest(BaseModel):
    email: EmailStr
    purpose: Literal["registration", "password_reset"]


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class OTPVerify(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    purpose: Literal["registration", "password_reset"] = "registration"


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)


class AdminRegistration(BaseModel):
    setup_token: str = Field(min_length=32, max_length=256)
    email: EmailStr
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=128)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(ORMModel):
    id: int
    email: EmailStr
    username: str
    role: str
    is_active: bool


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class PasswordReset(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128)


class StaffAccept(BaseModel):
    token: str
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)


class StaffInvite(BaseModel):
    email: EmailStr
    university_id: int


class StudentProfileUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    date_of_birth: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    country: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    education_level: str | None = Field(default=None, max_length=80)


class StudentProfileOut(ORMModel):
    id: int
    user_id: int
    first_name: str
    last_name: str
    date_of_birth: str | None
    country: str
    phone: str | None
    education_level: str | None


class AchievementCreate(BaseModel):
    category: str = Field(min_length=2, max_length=40)
    title: str = Field(min_length=1, max_length=160)
    score: float | None = Field(default=None, ge=0)
    awarded_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    issuer: str | None = Field(default=None, max_length=160)
    notes: str | None = None


class AchievementUpdate(BaseModel):
    category: str | None = Field(default=None, min_length=2, max_length=40)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    score: float | None = Field(default=None, ge=0)
    awarded_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    issuer: str | None = Field(default=None, max_length=160)
    notes: str | None = None


class AchievementOut(ORMModel):
    id: int
    category: str
    title: str
    score: float | None
    awarded_at: str | None
    issuer: str | None
    notes: str | None


class UniversityCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    country: str = Field(default="Uzbekistan", max_length=80)
    city: str = Field(min_length=1, max_length=100)
    description: str = ""
    website: str | None = Field(default=None, max_length=300)
    contact_email: EmailStr


class UniversityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    country: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=100)
    description: str | None = None
    website: str | None = Field(default=None, max_length=300)
    contact_email: EmailStr | None = None


class UniversityOut(ORMModel):
    id: int
    name: str
    country: str
    city: str
    description: str
    website: str | None
    contact_email: EmailStr
    is_approved: bool
    review_status: str


class UniversityDecision(BaseModel):
    decision: Literal["approve", "reject"]


class ProgramCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    degree: str = Field(min_length=2, max_length=60)
    subject: str = Field(min_length=2, max_length=120)
    language: str = Field(min_length=2, max_length=60)
    tuition: float = Field(ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    intake: str = Field(min_length=2, max_length=80)
    deadline: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    requirements: dict[str, Annotated[float, Field(ge=0)]] = Field(default_factory=dict)
    description: str = ""
    is_active: bool = True


class ProgramUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    degree: str | None = Field(default=None, min_length=2, max_length=60)
    subject: str | None = Field(default=None, min_length=2, max_length=120)
    language: str | None = Field(default=None, min_length=2, max_length=60)
    tuition: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    intake: str | None = Field(default=None, min_length=2, max_length=80)
    deadline: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    requirements: dict[str, Annotated[float, Field(ge=0)]] | None = None
    description: str | None = None
    is_active: bool | None = None


class ProgramOut(ORMModel):
    id: int
    university_id: int
    name: str
    degree: str
    subject: str
    language: str
    tuition: float
    currency: str
    intake: str
    deadline: str | None
    requirements: dict[str, Any]
    description: str
    is_active: bool


class ApplicationCreate(BaseModel):
    program_id: int
    intake: str = Field(min_length=2, max_length=80)
    personal_statement: str = Field(default="", max_length=10000)


class ApplicationUpdate(BaseModel):
    personal_statement: str = Field(max_length=10000)


class ApplicationOut(ORMModel):
    id: int
    student_id: int
    program_id: int
    intake: str
    status: str
    personal_statement: str
    eligibility: dict[str, Any]
    submitted_at: datetime | None
    created_at: datetime


class ReviewAction(BaseModel):
    action: Literal["accept", "reject", "request_information", "start_review"]
    comment: str | None = Field(default=None, max_length=5000)


class ReviewOut(ORMModel):
    id: int
    actor_id: int
    action: str
    from_status: str
    to_status: str
    comment: str | None
    created_at: datetime


class ReviewStats(BaseModel):
    total: int
    by_status: dict[str, int]


class DocumentOut(ORMModel):
    id: int
    application_id: int
    filename: str
    content_type: str
    size_bytes: int
    is_verified: bool
    verified_by: int | None
    created_at: datetime


class DocumentVerify(BaseModel):
    is_verified: bool


class NotificationOut(ORMModel):
    id: int
    title: str
    message: str
    is_read: bool
    created_at: datetime


class AdminUserUpdate(BaseModel):
    is_active: bool


class AdminStats(BaseModel):
    users: int
    students: int
    staff: int
    universities: int
    pending_universities: int
    programs: int
    applications: int


class MessageOut(BaseModel):
    message: str


class UnreadCountOut(BaseModel):
    unread_count: int


class UpdatedOut(BaseModel):
    updated: bool


class HealthOut(BaseModel):
    status: str
    database: str | None = None
