from pydantic import BaseModel

from src.models import CharacterPersonality, CharacterStoryRules, CharacterVisual

# Re-export src.models schemas — avoids duplicating identical Pydantic definitions
CharacterPersonalitySchema = CharacterPersonality
CharacterVisualSchema = CharacterVisual
CharacterStoryRulesSchema = CharacterStoryRules


class StoryListItem(BaseModel):
    slug: str
    title: str
    page_count: int
    has_images: bool
    has_pdf: bool
    has_video: bool = False
    animated_count: int = 0
    cover_url: str | None = None
    created_at: str | None = None
    title_translated: str | None = None
    parent_slug: str | None = None
    pipeline_status: str = "complete"  # story_review, cast_review, complete, draft
    is_auto: bool = False


class PipelineStartRequest(BaseModel):
    notes: str
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str | None = None
    text_model: str | None = None
    family_member_ids: list[str] | None = None
    allow_extra_cast: bool = True


class AutoPipelineRequest(BaseModel):
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str | None = None
    text_model: str | None = None
    family_member_ids: list[str] | None = None
    allow_extra_cast: bool = True


class TranslateRequest(BaseModel):
    language: str


class KeyframeUpdate(BaseModel):
    page_text: str | None = None
    visual_description: str | None = None
    mood: str | None = None
    page_text_translated: str | None = None


class CastMemberUpdate(BaseModel):
    name: str
    role: str
    species: str
    visual_description: str
    visual_constants: str
    appears_on_pages: list[int]


class StoryUpdate(BaseModel):
    title: str | None = None
    dedication: str | None = None
    keyframes: dict[int, KeyframeUpdate] | None = None
    cast: list[CastMemberUpdate] | None = None


class CoverSelectionRequest(BaseModel):
    choice: int  # 1-based: 1, 2, 3, or 4


class RegenerateRefSheetRequest(BaseModel):
    member_name: str


class ApproveRequest(BaseModel):
    choice: int  # 1-based cover selection: 1, 2, 3, or 4
    cast_edited: bool = False


class BranchRequest(BaseModel):
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str | None = None
    text_model: str | None = None
    start_from: str = "full"  # "full" | "illustration"


class PresetDetail(BaseModel):
    id: str
    name: str
    character: str
    narrator: str
    style: str
    pages: int
    language: str | None = None
    text_model: str = "gemini-2.5-pro"
    is_default: bool = False


class PresetCreateRequest(BaseModel):
    name: str
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str | None = None
    text_model: str = "gemini-2.5-pro"
    is_default: bool = False


class PresetUpdateRequest(BaseModel):
    name: str | None = None
    character: str | None = None
    narrator: str | None = None
    style: str | None = None
    pages: int | None = None
    language: str | None = None
    text_model: str | None = None
    is_default: bool | None = None


class TaskResponse(BaseModel):
    task_id: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, queued, running, completed, failed
    result: dict | None = None
    error: str | None = None


class SanityIssue(BaseModel):
    category: str
    severity: str  # trivial, major
    description: str
    auto_fixable: bool = False


class SanityCheckResult(BaseModel):
    page_number: int
    status: str  # pass, trivial, major
    issues: list[SanityIssue] = []
    suggested_visual_description: str | None = None


class CharacterDetail(BaseModel):
    id: str | None = None  # None for TOML templates
    slug: str
    name: str
    child_name: str
    personality: CharacterPersonalitySchema
    visual: CharacterVisualSchema
    story_rules: CharacterStoryRulesSchema
    is_template: bool = False
    pipeline_id: str  # What to send to pipeline: bare slug for templates, "custom:<uuid>" for DB
    reference_sheet_url: str | None = None
    has_photo: bool = False
    photo_url: str | None = None
    family_member_count: int = 0


class CharacterCreateRequest(BaseModel):
    slug: str
    name: str
    child_name: str
    personality: CharacterPersonalitySchema
    visual: CharacterVisualSchema
    story_rules: CharacterStoryRulesSchema


class CharacterUpdateRequest(BaseModel):
    slug: str | None = None
    name: str | None = None
    child_name: str | None = None
    personality: CharacterPersonalitySchema | None = None
    visual: CharacterVisualSchema | None = None
    story_rules: CharacterStoryRulesSchema | None = None


class CharacterPolishRequest(BaseModel):
    name: str
    child_name: str
    rough_description: str


class CharacterPolishResponse(BaseModel):
    personality: CharacterPersonalitySchema
    visual: CharacterVisualSchema
    story_rules: CharacterStoryRulesSchema


class CharacterInfo(BaseModel):
    name: str
    slug: str
    child_name: str
    description: str
    constants: str


class StyleInfo(BaseModel):
    name: str
    description: str
    preview_url: str | None = None


class NarratorInfo(BaseModel):
    name: str
    slug: str
    description: str
    example: str


class FamilyMemberInfo(BaseModel):
    link_id: str
    member_id: str
    member_pipeline_id: str
    member_name: str
    relationship_label: str
    sort_order: int
    reference_sheet_url: str | None = None
    color_palette: list[str] = []


class AddFamilyMemberRequest(BaseModel):
    member_id: str
    relationship_label: str


class CreateAndLinkFamilyMemberRequest(BaseModel):
    character: CharacterCreateRequest
    relationship_label: str


class UpdateFamilyLinkRequest(BaseModel):
    relationship_label: str | None = None
    sort_order: int | None = None


class ReorderFamilyRequest(BaseModel):
    ordered_member_ids: list[str]
