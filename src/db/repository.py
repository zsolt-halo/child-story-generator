from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.exc import NoResultFound

from src.db.engine import get_async_session_factory, get_sync_session_factory
from src.db.models import CastMemberRow, KeyframeRow, StoryRow
from src.models import CastMember, Keyframe, Story

STORIES_DIR = Path("stories")


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def _image_prefix(kf_row: KeyframeRow) -> str:
    """Derive image filename prefix from a keyframe row."""
    return "cover" if kf_row.is_cover else f"page_{kf_row.page_number:02d}"


def _row_to_story(row: StoryRow) -> Story:
    """Convert an ORM StoryRow (with eager-loaded children) to a Pydantic Story."""
    keyframes = [
        Keyframe(
            page_number=kf.page_number,
            page_text=kf.page_text,
            visual_description=kf.visual_description,
            mood=kf.mood,
            beat_summary=kf.beat_summary or "",
            is_cover=kf.is_cover,
            page_text_translated=kf.page_text_translated,
        )
        for kf in row.keyframes
    ]
    cast = [
        CastMember(
            name=cm.name or "",
            role=cm.role or "",
            species=cm.species or "",
            visual_description=cm.visual_description or "",
            visual_constants=cm.visual_constants or "",
            appears_on_pages=cm.appears_on_pages or [],
        )
        for cm in row.cast_members
    ]
    return Story(
        title=row.title,
        dedication=row.dedication or "",
        keyframes=keyframes,
        cast=cast,
        title_translated=row.title_translated,
        dedication_translated=row.dedication_translated,
    )


def _image_paths_from_row(row: StoryRow) -> list[Path]:
    """Derive on-disk image paths from keyframes that have images."""
    paths: list[Path] = []
    for kf in row.keyframes:
        if kf.has_image:
            prefix = _image_prefix(kf)
            paths.append(STORIES_DIR / row.slug / "images" / f"{prefix}.png")
    return paths


def _story_to_row(
    slug: str,
    story: Story,
    metadata: dict | None = None,
    image_paths: list[str | Path] | None = None,
) -> StoryRow:
    """Convert a Pydantic Story + metadata into an ORM StoryRow with children."""
    config = (metadata or {}).get("config", {})
    parent_slug = (metadata or {}).get("parent_slug")
    notes = (metadata or {}).get("notes")
    created_at_str = (metadata or {}).get("created_at")

    # Determine which pages have images on disk
    image_page_set: set[str] = set()
    for p in image_paths or []:
        image_page_set.add(Path(p).stem)  # e.g. "cover", "page_01"

    has_images = len(image_page_set) > 0
    has_pdf = (STORIES_DIR / slug / "book.pdf").exists()

    created_at = None
    if created_at_str:
        try:
            created_at = datetime.fromisoformat(created_at_str)
        except (ValueError, TypeError):
            pass

    row = StoryRow(
        slug=slug,
        title=story.title,
        dedication=story.dedication,
        title_translated=story.title_translated,
        dedication_translated=story.dedication_translated,
        notes=notes,
        parent_slug=parent_slug,
        character=config.get("character", "lana-llama"),
        narrator=config.get("narrator", "whimsical"),
        style=config.get("style", "digital"),
        pages=config.get("pages", 16),
        language=config.get("language"),
        has_images=has_images,
        has_pdf=has_pdf,
    )
    if created_at is not None:
        row.created_at = created_at

    row.keyframes = [
        KeyframeRow(
            page_number=kf.page_number,
            page_text=kf.page_text,
            visual_description=kf.visual_description,
            mood=kf.mood,
            beat_summary=kf.beat_summary,
            is_cover=kf.is_cover,
            page_text_translated=kf.page_text_translated,
            has_image=kf.image_prefix in image_page_set,
        )
        for kf in story.keyframes
    ]

    row.cast_members = [
        CastMemberRow(
            name=cm.name,
            role=cm.role,
            species=cm.species,
            visual_description=cm.visual_description,
            visual_constants=cm.visual_constants,
            appears_on_pages=cm.appears_on_pages,
        )
        for cm in story.cast
    ]

    return row


def _row_to_metadata(row: StoryRow) -> dict | None:
    """Reconstruct the metadata dict from a StoryRow."""
    config = {
        "character": row.character,
        "narrator": row.narrator,
        "style": row.style,
        "pages": row.pages,
        "language": row.language,
    }
    return {
        "notes": row.notes,
        "config": config,
        "parent_slug": row.parent_slug,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _cover_url_from_row(row: StoryRow) -> str | None:
    """Return a cover image URL if the story has a cover keyframe with an image."""
    for kf in row.keyframes:
        if kf.is_cover and kf.has_image:
            return f"/api/stories/{row.slug}/images/cover.png"
    return None


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


class StoryRepository:
    """Provides both sync (CLI) and async (server) data access for stories."""

    # -----------------------------------------------------------------------
    # Sync methods (for CLI)
    # -----------------------------------------------------------------------

    def save(
        self,
        slug: str,
        story: Story,
        image_paths: list[str | Path] | None = None,
        metadata: dict | None = None,
    ) -> None:
        """Upsert a story: insert or update by slug."""
        Session = get_sync_session_factory()
        with Session() as session:
            existing = session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            ).scalar_one_or_none()

            if existing is not None:
                self._update_row_from_story(
                    existing, story, metadata, image_paths, session
                )
            else:
                row = _story_to_row(slug, story, metadata, image_paths)
                session.add(row)

            session.commit()

    def get(self, slug: str) -> tuple[Story, list[Path]]:
        """Load a story by slug. Returns (Story, image_paths)."""
        Session = get_sync_session_factory()
        with Session() as session:
            row = session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            ).scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Story not found: {slug}")
            story = _row_to_story(row)
            paths = _image_paths_from_row(row)
            return story, paths

    def list_all(self) -> list[dict]:
        """Return summary dicts for all stories, newest first."""
        Session = get_sync_session_factory()
        with Session() as session:
            rows = session.execute(
                select(StoryRow).order_by(StoryRow.created_at.desc())
            ).scalars().all()
            return [self._row_to_list_item(r) for r in rows]

    def delete(self, slug: str) -> None:
        """Delete a story by slug."""
        Session = get_sync_session_factory()
        with Session() as session:
            row = session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            ).scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Story not found: {slug}")
            session.delete(row)
            session.commit()

    def get_metadata(self, slug: str) -> dict | None:
        """Load just metadata for a story."""
        Session = get_sync_session_factory()
        with Session() as session:
            row = session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            ).scalar_one_or_none()
            if row is None:
                return None
            return _row_to_metadata(row)

    # -----------------------------------------------------------------------
    # Async methods (for server)
    # -----------------------------------------------------------------------

    async def async_save(
        self,
        slug: str,
        story: Story,
        image_paths: list[str | Path] | None = None,
        metadata: dict | None = None,
    ) -> None:
        """Async upsert a story: insert or update by slug."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            )
            existing = result.scalar_one_or_none()

            if existing is not None:
                await self._async_update_row_from_story(
                    existing, story, metadata, image_paths, session
                )
            else:
                row = _story_to_row(slug, story, metadata, image_paths)
                session.add(row)

            await session.commit()

    async def async_get(self, slug: str) -> tuple[Story, list[Path]]:
        """Async load a story by slug."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Story not found: {slug}")
            story = _row_to_story(row)
            paths = _image_paths_from_row(row)
            return story, paths

    async def async_list(self) -> list[dict]:
        """Async return summary dicts for all stories, newest first."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(StoryRow).order_by(StoryRow.created_at.desc())
            )
            rows = result.scalars().all()
            return [self._row_to_list_item(r) for r in rows]

    async def async_delete(self, slug: str) -> None:
        """Async delete a story by slug."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Story not found: {slug}")
            await session.delete(row)
            await session.commit()

    async def async_update(
        self,
        slug: str,
        title: str | None = None,
        dedication: str | None = None,
        keyframe_updates: dict[int, dict] | None = None,
        cast_updates: list[dict] | None = None,
    ) -> Story:
        """Async partial update of a story's fields."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Story not found: {slug}")

            if title is not None:
                row.title = title
            if dedication is not None:
                row.dedication = dedication

            if keyframe_updates:
                for kf_row in row.keyframes:
                    if kf_row.page_number in keyframe_updates:
                        updates = keyframe_updates[kf_row.page_number]
                        if "page_text" in updates and updates["page_text"] is not None:
                            kf_row.page_text = updates["page_text"]
                        if (
                            "visual_description" in updates
                            and updates["visual_description"] is not None
                        ):
                            kf_row.visual_description = updates["visual_description"]
                        if "mood" in updates and updates["mood"] is not None:
                            kf_row.mood = updates["mood"]
                        if (
                            "page_text_translated" in updates
                            and updates["page_text_translated"] is not None
                        ):
                            kf_row.page_text_translated = updates[
                                "page_text_translated"
                            ]

            if cast_updates is not None:
                # Replace all cast members
                await session.execute(
                    delete(CastMemberRow).where(
                        CastMemberRow.story_id == row.id
                    )
                )
                row.cast_members = [
                    CastMemberRow(
                        story_id=row.id,
                        name=cm.get("name"),
                        role=cm.get("role"),
                        species=cm.get("species"),
                        visual_description=cm.get("visual_description"),
                        visual_constants=cm.get("visual_constants"),
                        appears_on_pages=cm.get("appears_on_pages"),
                    )
                    for cm in cast_updates
                ]

            row.updated_at = datetime.now(timezone.utc)
            await session.commit()

            # Refresh to get the final state with relationships
            await session.refresh(row)
            return _row_to_story(row)

    async def async_get_metadata(self, slug: str) -> dict | None:
        """Async load just metadata for a story."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(StoryRow).where(StoryRow.slug == slug)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            return _row_to_metadata(row)

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _update_row_from_story(
        self,
        row: StoryRow,
        story: Story,
        metadata: dict | None,
        image_paths: list[str | Path] | None,
        session,
    ) -> None:
        """Update an existing StoryRow in-place (sync)."""
        config = (metadata or {}).get("config", {})

        row.title = story.title
        row.dedication = story.dedication
        row.title_translated = story.title_translated
        row.dedication_translated = story.dedication_translated

        if metadata is not None:
            row.notes = metadata.get("notes", row.notes)
            row.parent_slug = metadata.get("parent_slug", row.parent_slug)
            if config:
                row.character = config.get("character", row.character)
                row.narrator = config.get("narrator", row.narrator)
                row.style = config.get("style", row.style)
                row.pages = config.get("pages", row.pages)
                row.language = config.get("language", row.language)

        # Determine which pages have images
        image_page_set: set[str] = set()
        for p in image_paths or []:
            image_page_set.add(Path(p).stem)

        row.has_images = len(image_page_set) > 0
        row.has_pdf = (STORIES_DIR / row.slug / "book.pdf").exists()
        row.updated_at = datetime.now(timezone.utc)

        # Replace keyframes
        row.keyframes.clear()
        for kf in story.keyframes:
            row.keyframes.append(
                KeyframeRow(
                    story_id=row.id,
                    page_number=kf.page_number,
                    page_text=kf.page_text,
                    visual_description=kf.visual_description,
                    mood=kf.mood,
                    beat_summary=kf.beat_summary,
                    is_cover=kf.is_cover,
                    page_text_translated=kf.page_text_translated,
                    has_image=kf.image_prefix in image_page_set,
                )
            )

        # Replace cast members
        row.cast_members.clear()
        for cm in story.cast:
            row.cast_members.append(
                CastMemberRow(
                    story_id=row.id,
                    name=cm.name,
                    role=cm.role,
                    species=cm.species,
                    visual_description=cm.visual_description,
                    visual_constants=cm.visual_constants,
                    appears_on_pages=cm.appears_on_pages,
                )
            )

    async def _async_update_row_from_story(
        self,
        row: StoryRow,
        story: Story,
        metadata: dict | None,
        image_paths: list[str | Path] | None,
        session,
    ) -> None:
        """Update an existing StoryRow in-place (async).

        The logic mirrors the sync version; the async session handles
        flushing the collection changes.
        """
        config = (metadata or {}).get("config", {})

        row.title = story.title
        row.dedication = story.dedication
        row.title_translated = story.title_translated
        row.dedication_translated = story.dedication_translated

        if metadata is not None:
            row.notes = metadata.get("notes", row.notes)
            row.parent_slug = metadata.get("parent_slug", row.parent_slug)
            if config:
                row.character = config.get("character", row.character)
                row.narrator = config.get("narrator", row.narrator)
                row.style = config.get("style", row.style)
                row.pages = config.get("pages", row.pages)
                row.language = config.get("language", row.language)

        image_page_set: set[str] = set()
        for p in image_paths or []:
            image_page_set.add(Path(p).stem)

        row.has_images = len(image_page_set) > 0
        row.has_pdf = (STORIES_DIR / row.slug / "book.pdf").exists()
        row.updated_at = datetime.now(timezone.utc)

        # Replace keyframes — clear + re-add
        row.keyframes.clear()
        await session.flush()
        for kf in story.keyframes:
            row.keyframes.append(
                KeyframeRow(
                    story_id=row.id,
                    page_number=kf.page_number,
                    page_text=kf.page_text,
                    visual_description=kf.visual_description,
                    mood=kf.mood,
                    beat_summary=kf.beat_summary,
                    is_cover=kf.is_cover,
                    page_text_translated=kf.page_text_translated,
                    has_image=kf.image_prefix in image_page_set,
                )
            )

        # Replace cast members
        row.cast_members.clear()
        await session.flush()
        for cm in story.cast:
            row.cast_members.append(
                CastMemberRow(
                    story_id=row.id,
                    name=cm.name,
                    role=cm.role,
                    species=cm.species,
                    visual_description=cm.visual_description,
                    visual_constants=cm.visual_constants,
                    appears_on_pages=cm.appears_on_pages,
                )
            )

    @staticmethod
    def _row_to_list_item(row: StoryRow) -> dict:
        """Convert a StoryRow to a summary dict for list endpoints."""
        has_keyframes = len(row.keyframes) > 0
        cast_count = len(row.cast_members)
        has_images = row.has_images

        if has_images:
            pipeline_status = "complete"
        elif cast_count > 0:
            pipeline_status = "cast_review"
        elif has_keyframes:
            pipeline_status = "story_review"
        else:
            pipeline_status = "draft"

        return {
            "slug": row.slug,
            "title": row.title,
            "page_count": len(row.keyframes),
            "has_images": has_images,
            "has_pdf": row.has_pdf,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "title_translated": row.title_translated,
            "parent_slug": row.parent_slug,
            "cover_url": _cover_url_from_row(row),
            "pipeline_status": pipeline_status,
            "is_auto": bool(row.notes and row.notes.startswith("[auto]")),
        }
