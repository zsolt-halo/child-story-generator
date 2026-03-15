import type {
  StoryListItem,
  StoryDetail,
  CharacterInfo,
  StyleInfo,
  NarratorInfo,
  PipelineStartRequest,
  AutoPipelineRequest,
  TaskResponse,
  TaskStatus,
  SanityCheckResult,
  BranchRequest,
  CharacterDetail,
  CharacterCreateRequest,
  CharacterPolishRequest,
  CharacterPolishResponse,
  PresetDetail,
  PresetCreateRequest,
  PresetUpdateRequest,
  FamilyMemberInfo,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Stories
export const listStories = () => request<StoryListItem[]>("/stories/");
export const getStory = (slug: string) => request<StoryDetail>(`/stories/${slug}`);
export const updateStory = (slug: string, data: Record<string, unknown>) =>
  request(`/stories/${slug}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteStory = (slug: string) =>
  request(`/stories/${slug}`, { method: "DELETE" });

// Config
export const getCharacters = () => request<CharacterInfo[]>("/config/characters");
export const getStyles = () => request<StyleInfo[]>("/config/styles");
export const getNarrators = () => request<NarratorInfo[]>("/config/narrators");
export const getPhaseAverages = () => request<Record<string, number>>("/config/phase-averages");

// Pipeline
export const startPipeline = (req: PipelineStartRequest) =>
  request<TaskResponse>("/pipeline/start", { method: "POST", body: JSON.stringify(req) });
export const startStoryOnly = (req: PipelineStartRequest) =>
  request<TaskResponse>("/pipeline/story", { method: "POST", body: JSON.stringify(req) });
export const startAutoGenerate = (req: AutoPipelineRequest) =>
  request<TaskResponse>("/pipeline/auto", { method: "POST", body: JSON.stringify(req) });
export const startTranslate = (slug: string, language: string) =>
  request<TaskResponse>(`/pipeline/translate/${slug}`, {
    method: "POST",
    body: JSON.stringify({ language }),
  });
export const startIllustrate = (slug: string) =>
  request<TaskResponse>(`/pipeline/illustrate/${slug}`, { method: "POST" });
export const startIllustratePage = (slug: string, page: number) =>
  request<TaskResponse>(`/pipeline/illustrate/${slug}/${page}`, { method: "POST" });
export const continuePipeline = (slug: string, castEdited = false) =>
  request<TaskResponse>(`/pipeline/continue/${slug}?cast_edited=${castEdited}`, { method: "POST" });
export const selectCoverAndContinue = (slug: string, choice: number) =>
  request<TaskResponse>(`/pipeline/select-cover/${slug}`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
export const startCastExtraction = (slug: string) =>
  request<TaskResponse>(`/pipeline/cast/${slug}`, { method: "POST" });
export const approvePipeline = (slug: string, choice: number, castEdited = false) =>
  request<TaskResponse>(`/pipeline/approve/${slug}`, {
    method: "POST",
    body: JSON.stringify({ choice, cast_edited: castEdited }),
  });
export const regenerateCastRefSheet = (slug: string, memberName: string) =>
  request<TaskResponse>(`/pipeline/regenerate-ref-sheet/${slug}`, {
    method: "POST",
    body: JSON.stringify({ member_name: memberName }),
  });
export const branchStory = (slug: string, req: BranchRequest) =>
  request<TaskResponse>(`/pipeline/branch/${slug}`, { method: "POST", body: JSON.stringify(req) });
export const startAnimate = (slug: string) =>
  request<TaskResponse>(`/pipeline/animate/${slug}`, { method: "POST" });
export const getWorkerStatus = () =>
  request<{ available: boolean; last_seen: string | null; queue: unknown }>("/worker/status");
export const startPdf = (slug: string) =>
  request<TaskResponse>(`/pipeline/pdf/${slug}`, { method: "POST" });
export const getTaskStatus = (taskId: string) =>
  request<TaskStatus>(`/pipeline/status/${taskId}`);

// Sanity
export const startSanityCheck = (slug: string) =>
  request<TaskResponse>(`/sanity/check/${slug}`, { method: "POST" });
export const checkSinglePage = (slug: string, page: number) =>
  request<SanityCheckResult>(`/sanity/check/${slug}/${page}`, { method: "POST" });
export const startAutoFix = (slug: string, page: number) =>
  request<TaskResponse>(`/sanity/fix/${slug}/${page}`, { method: "POST" });

// Characters (full CRUD)
export const listAllCharacters = () => request<CharacterDetail[]>("/characters/");
export const getCharacterDetail = (id: string) => request<CharacterDetail>(`/characters/${id}`);
export const createCharacter = (data: CharacterCreateRequest) =>
  request<CharacterDetail>("/characters/", { method: "POST", body: JSON.stringify(data) });
export const updateCharacter = (id: string, data: Record<string, unknown>) =>
  request<CharacterDetail>(`/characters/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCharacter = (id: string) =>
  request(`/characters/${id}`, { method: "DELETE" });
export const duplicateCharacter = (id: string) =>
  request<CharacterDetail>(`/characters/${id}/duplicate`, { method: "POST" });
export const duplicateTemplate = (slug: string) =>
  request<CharacterDetail>(`/characters/duplicate-template/${slug}`, { method: "POST" });
export const polishCharacter = (data: CharacterPolishRequest) =>
  request<CharacterPolishResponse>("/characters/polish", { method: "POST", body: JSON.stringify(data) });
export const generateCharacterRefSheet = (identifier: string) =>
  request<TaskResponse>(`/characters/${identifier}/generate-reference-sheet`, { method: "POST" });

export const uploadCharacterPhoto = async (id: string, file: File): Promise<CharacterDetail> => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE}/characters/${id}/photo`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<CharacterDetail>;
};

export const deleteCharacterPhoto = (id: string) =>
  request(`/characters/${id}/photo`, { method: "DELETE" });

// Family tree
export const getFamilyTree = (charId: string) =>
  request<FamilyMemberInfo[]>(`/characters/${charId}/family`);
export const addFamilyMember = (charId: string, data: { member_id: string; relationship_label: string }) =>
  request<FamilyMemberInfo>(`/characters/${charId}/family`, { method: "POST", body: JSON.stringify(data) });
export const createAndLinkFamilyMember = (charId: string, data: { character: CharacterCreateRequest; relationship_label: string }) =>
  request<FamilyMemberInfo>(`/characters/${charId}/family/create`, { method: "POST", body: JSON.stringify(data) });
export const removeFamilyMember = (charId: string, linkId: string) =>
  request(`/characters/${charId}/family/${linkId}`, { method: "DELETE" });
export const updateFamilyLink = (charId: string, linkId: string, data: { relationship_label?: string; sort_order?: number }) =>
  request<FamilyMemberInfo>(`/characters/${charId}/family/${linkId}`, { method: "PUT", body: JSON.stringify(data) });
export const reorderFamily = (charId: string, orderedMemberIds: string[]) =>
  request<FamilyMemberInfo[]>(`/characters/${charId}/family/reorder`, { method: "PUT", body: JSON.stringify({ ordered_member_ids: orderedMemberIds }) });

// Presets
export const listPresets = () => request<PresetDetail[]>("/presets/");
export const createPreset = (data: PresetCreateRequest) =>
  request<PresetDetail>("/presets/", { method: "POST", body: JSON.stringify(data) });
export const updatePreset = (id: string, data: PresetUpdateRequest) =>
  request<PresetDetail>(`/presets/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePreset = (id: string) =>
  request(`/presets/${id}`, { method: "DELETE" });
