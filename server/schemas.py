from pydantic import BaseModel


class StoryListItem(BaseModel):
    slug: str
    title: str
    page_count: int
    has_images: bool
    has_pdf: bool
    cover_url: str | None = None
    created_at: str | None = None
    title_translated: str | None = None
    parent_slug: str | None = None


class PipelineStartRequest(BaseModel):
    notes: str
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str | None = None


class TranslateRequest(BaseModel):
    language: str


class KeyframeUpdate(BaseModel):
    page_text: str | None = None
    visual_description: str | None = None
    mood: str | None = None


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


class BranchRequest(BaseModel):
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str | None = None
    start_from: str = "full"  # "full" | "illustration"


class TaskResponse(BaseModel):
    task_id: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, running, completed, failed
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


class CharacterInfo(BaseModel):
    name: str
    slug: str
    child_name: str
    description: str
    constants: str


class StyleInfo(BaseModel):
    name: str
    description: str


class NarratorInfo(BaseModel):
    name: str
    slug: str
    description: str
    example: str
