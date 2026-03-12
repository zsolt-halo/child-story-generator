export interface StoryListItem {
  slug: string;
  title: string;
  page_count: number;
  has_images: boolean;
  has_pdf: boolean;
  cover_url: string | null;
  created_at: string | null;
  title_translated: string | null;
  parent_slug: string | null;
  pipeline_status: "story_review" | "cast_review" | "complete" | "draft";
  is_auto?: boolean;
}

export interface Keyframe {
  page_number: number;
  page_text: string;
  visual_description: string;
  mood: string;
  beat_summary: string;
  is_cover: boolean;
  page_text_translated: string | null;
}

export interface CastMember {
  name: string;
  role: string;
  species: string;
  visual_description: string;
  visual_constants: string;
  appears_on_pages: number[];
}

export interface Story {
  title: string;
  dedication: string;
  keyframes: Keyframe[];
  cast: CastMember[];
  title_translated: string | null;
  dedication_translated: string | null;
}

export interface StoryMetadata {
  notes: string;
  config: {
    character: string;
    narrator: string;
    style: string;
    pages: number;
    language: string | null;
  };
  parent_slug: string | null;
  created_at: string;
}

export interface StoryDetail {
  slug: string;
  story: Story;
  image_urls: Record<number, string>;
  backdrop_urls: string[];
  cover_variation_urls: string[];
  reference_sheet_url: string | null;
  cast_ref_urls: Record<string, string>;
  has_pdf: boolean;
  has_screen_pdf: boolean;
  has_spread_pdf: boolean;
  metadata: StoryMetadata | null;
}

export interface BranchRequest {
  character: string;
  narrator: string;
  style: string;
  pages: number;
  language?: string;
  start_from: "full" | "illustration";
}

export interface CharacterInfo {
  name: string;
  slug: string;
  child_name: string;
  description: string;
  constants: string;
}

export interface StyleInfo {
  name: string;
  description: string;
  preview_url: string | null;
}

export interface NarratorInfo {
  name: string;
  slug: string;
  description: string;
  example: string;
}

export interface PresetDetail {
  id: string;
  name: string;
  character: string;
  narrator: string;
  style: string;
  pages: number;
  language: string | null;
  text_model: string;
  is_default: boolean;
}

export interface PresetCreateRequest {
  name: string;
  character: string;
  narrator: string;
  style: string;
  pages: number;
  language?: string;
  text_model?: string;
  is_default?: boolean;
}

export interface PresetUpdateRequest {
  name?: string;
  character?: string;
  narrator?: string;
  style?: string;
  pages?: number;
  language?: string | null;
  text_model?: string;
  is_default?: boolean;
}

export interface PipelineStartRequest {
  notes: string;
  character: string;
  narrator: string;
  style: string;
  pages: number;
  language?: string;
  text_model?: string;
}

export interface AutoPipelineRequest {
  character: string;
  narrator: string;
  style: string;
  pages: number;
  language?: string;
  text_model?: string;
}

export interface TaskResponse {
  task_id: string;
}

export interface TaskStatus {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface CoverVariation {
  index: number;
  url: string;
}

export interface SSEEvent {
  type: string;
  phase?: string;
  message?: string;
  elapsed?: number;
  data?: Record<string, unknown>;
  page?: number;
  is_cover?: boolean;
  url?: string;
  progress?: number;
  total?: number;
  skipped?: boolean;
  result?: Record<string, unknown>;
  error?: string;
  index?: number;
  position?: number;
  queue_ahead?: number;
  name?: string;
}

export interface SanityIssue {
  category: string;
  severity: "trivial" | "major";
  description: string;
  auto_fixable: boolean;
}

export interface SanityCheckResult {
  page_number: number;
  status: "pass" | "trivial" | "major";
  issues: SanityIssue[];
  suggested_visual_description: string | null;
}

export interface CharacterPersonality {
  traits: string[];
  speech_style: string;
}

export interface CharacterVisual {
  description: string;
  constants: string;
  color_palette: string[];
}

export interface CharacterStoryRules {
  always: string;
  never: string;
}

export interface CharacterDetail {
  id: string | null;
  slug: string;
  name: string;
  child_name: string;
  personality: CharacterPersonality;
  visual: CharacterVisual;
  story_rules: CharacterStoryRules;
  is_template: boolean;
  pipeline_id: string;
}

export interface CharacterCreateRequest {
  slug: string;
  name: string;
  child_name: string;
  personality: CharacterPersonality;
  visual: CharacterVisual;
  story_rules: CharacterStoryRules;
}

export interface CharacterPolishRequest {
  name: string;
  child_name: string;
  rough_description: string;
}

export interface CharacterPolishResponse {
  personality: CharacterPersonality;
  visual: CharacterVisual;
  story_rules: CharacterStoryRules;
}
