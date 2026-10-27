from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:change-me@localhost:5432/uniapply"
    secret_key: str = Field(min_length=32)
    access_token_expire_minutes: int = Field(default=60, gt=0)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    email_from: str = ""
    upload_dir: str = "private_uploads"
    max_upload_size_mb: int = Field(default=10, gt=0)
    otp_expire_minutes: int = Field(default=5, gt=0)
    otp_max_attempts: int = Field(default=5, gt=0)
    initial_admin_email: str = ""
    initial_admin_username: str = ""
    initial_admin_password: str = ""
    admin_setup_token: str = ""
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
