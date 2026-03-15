from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select, delete

from src.db.engine import get_async_session_factory
from src.db.models import FamilyLinkRow, CharacterRow

if TYPE_CHECKING:
    from src.models import Character


class FamilyRepository:
    """CRUD for family links (star topology: protagonist ↔ family members)."""

    async def async_list_members(self, character_id: uuid.UUID) -> list[FamilyLinkRow]:
        """List all family members for a protagonist character."""
        async with get_async_session_factory()() as session:
            result = await session.execute(
                select(FamilyLinkRow)
                .where(FamilyLinkRow.character_id == character_id)
                .order_by(FamilyLinkRow.sort_order)
            )
            return list(result.scalars().all())

    async def async_add_member(
        self,
        character_id: uuid.UUID,
        member_id: uuid.UUID,
        relationship_label: str,
        sort_order: int = 0,
    ) -> FamilyLinkRow:
        """Add a family member link. Raises ValueError if self-link."""
        if character_id == member_id:
            raise ValueError("A character cannot be their own family member")

        async with get_async_session_factory()() as session:
            link = FamilyLinkRow(
                character_id=character_id,
                member_id=member_id,
                relationship_label=relationship_label,
                sort_order=sort_order,
            )
            session.add(link)
            await session.commit()
            await session.refresh(link, ["member"])
            return link

    async def async_remove_member(self, link_id: uuid.UUID) -> None:
        """Remove a family link by its own ID."""
        async with get_async_session_factory()() as session:
            await session.execute(
                delete(FamilyLinkRow).where(FamilyLinkRow.id == link_id)
            )
            await session.commit()

    async def async_update_link(
        self,
        link_id: uuid.UUID,
        relationship_label: str | None = None,
        sort_order: int | None = None,
    ) -> FamilyLinkRow:
        """Update a family link's label and/or sort order."""
        async with get_async_session_factory()() as session:
            result = await session.execute(
                select(FamilyLinkRow).where(FamilyLinkRow.id == link_id)
            )
            link = result.scalar_one_or_none()
            if link is None:
                raise FileNotFoundError(f"Family link {link_id} not found")
            if relationship_label is not None:
                link.relationship_label = relationship_label
            if sort_order is not None:
                link.sort_order = sort_order
            await session.commit()
            await session.refresh(link, ["member"])
            return link

    async def async_reorder(
        self, character_id: uuid.UUID, ordered_member_ids: list[uuid.UUID]
    ) -> list[FamilyLinkRow]:
        """Reorder family members by setting sort_order based on list position."""
        async with get_async_session_factory()() as session:
            result = await session.execute(
                select(FamilyLinkRow)
                .where(FamilyLinkRow.character_id == character_id)
            )
            links = {link.member_id: link for link in result.scalars().all()}
            for i, mid in enumerate(ordered_member_ids):
                if mid in links:
                    links[mid].sort_order = i
            await session.commit()
            # Re-fetch ordered
            result = await session.execute(
                select(FamilyLinkRow)
                .where(FamilyLinkRow.character_id == character_id)
                .order_by(FamilyLinkRow.sort_order)
            )
            return list(result.scalars().all())

    async def async_resolve_members(
        self, member_ids: list[uuid.UUID]
    ) -> list[tuple[Character, str]]:
        """Resolve member IDs to (Character pydantic model, relationship_label) tuples.

        Used by the pipeline to get canonical family member data.
        """
        from src.db.character_repository import CharacterRepository, _row_to_character

        if not member_ids:
            return []

        async with get_async_session_factory()() as session:
            # Get all family link rows that reference these member IDs
            # We need the relationship_label from the link
            result = await session.execute(
                select(FamilyLinkRow)
                .where(FamilyLinkRow.member_id.in_(member_ids))
            )
            link_map: dict[uuid.UUID, str] = {}
            for link in result.scalars().all():
                link_map[link.member_id] = link.relationship_label

            # Get the actual character rows
            result = await session.execute(
                select(CharacterRow)
                .where(CharacterRow.id.in_(member_ids))
            )
            rows = result.scalars().all()

        members = []
        for row in rows:
            char = _row_to_character(row)
            label = link_map.get(row.id, "Family")
            members.append((char, label))
        return members
