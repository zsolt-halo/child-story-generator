from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class StoryRow(Base):
    __tablename__ = "stories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    dedication: Mapped[str] = mapped_column(Text, default="")
    title_translated: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dedication_translated: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_slug: Mapped[str | None] = mapped_column(String(80), nullable=True)
    character: Mapped[str] = mapped_column(String(200), default="lana-llama")
    narrator: Mapped[str] = mapped_column(String(40), default="whimsical")
    style: Mapped[str] = mapped_column(String(40), default="digital")
    pages: Mapped[int] = mapped_column(Integer, default=16)
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    has_images: Mapped[bool] = mapped_column(Boolean, default=False)
    has_pdf: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    keyframes: Mapped[list[KeyframeRow]] = relationship(
        "KeyframeRow",
        back_populates="story",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="KeyframeRow.page_number",
    )
    cast_members: Mapped[list[CastMemberRow]] = relationship(
        "CastMemberRow",
        back_populates="story",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class KeyframeRow(Base):
    __tablename__ = "keyframes"
    __table_args__ = (
        UniqueConstraint("story_id", "page_number", name="uq_keyframe_story_page"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    story_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False,
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    page_text: Mapped[str] = mapped_column(Text, nullable=False)
    visual_description: Mapped[str] = mapped_column(Text, nullable=False)
    mood: Mapped[str] = mapped_column(String(100), nullable=False)
    is_cover: Mapped[bool] = mapped_column(Boolean, default=False)
    page_text_translated: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_image: Mapped[bool] = mapped_column(Boolean, default=False)

    story: Mapped[StoryRow] = relationship("StoryRow", back_populates="keyframes")


class CastMemberRow(Base):
    __tablename__ = "cast_members"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    story_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str | None] = mapped_column(String(200), nullable=True)
    species: Mapped[str | None] = mapped_column(String(200), nullable=True)
    visual_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visual_constants: Mapped[str | None] = mapped_column(Text, nullable=True)
    appears_on_pages: Mapped[list[int] | None] = mapped_column(
        ARRAY(Integer), nullable=True
    )

    story: Mapped[StoryRow] = relationship("StoryRow", back_populates="cast_members")


class CharacterRow(Base):
    __tablename__ = "characters"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    slug: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    child_name: Mapped[str] = mapped_column(String(200), nullable=False)
    traits: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    speech_style: Mapped[str | None] = mapped_column(Text, nullable=True)
    visual_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    visual_const: Mapped[str | None] = mapped_column(Text, nullable=True)
    color_palette: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    rules_always: Mapped[str | None] = mapped_column(Text, nullable=True)
    rules_never: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_template: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class PhaseTimingRow(Base):
    """Historical pipeline phase durations for ETA estimation."""
    __tablename__ = "phase_timings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    phase: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
