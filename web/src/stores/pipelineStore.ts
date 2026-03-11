import { create } from "zustand";
import type { SSEEvent, CastMember, CoverVariation } from "../api/types";

interface ImageStatus {
  page: number;
  is_cover: boolean;
  url: string;
  skipped: boolean;
}

interface PipelineState {
  taskId: string | null;
  phase: string | null;
  phaseMessage: string | null;
  completed: boolean;
  failed: boolean;
  error: string | null;
  images: ImageStatus[];
  imageProgress: number;
  imageTotal: number;
  resultSlug: string | null;
  resultTitle: string | null;
  castMembers: CastMember[];
  castRefUrls: Record<string, string>;
  mainRefSheetUrl: string | null;
  waitingForStoryReview: boolean;
  waitingForCastReview: boolean;
  coverVariations: CoverVariation[];
  waitingForCoverSelection: boolean;
  queuePosition: number;
  queueAhead: number;

  // Phase timing & detail tracking
  phaseData: Record<string, Record<string, unknown>>;
  phaseStartTime: number | null;
  phaseElapsed: Record<string, number>;

  setTaskId: (id: string) => void;
  handleEvent: (event: SSEEvent) => void;
  restoreState: (data: {
    slug: string;
    title?: string;
    waitingForStoryReview?: boolean;
    waitingForCastReview?: boolean;
    waitingForCoverSelection?: boolean;
    castMembers?: CastMember[];
    coverVariations?: CoverVariation[];
    castRefUrls?: Record<string, string>;
    mainRefSheetUrl?: string | null;
  }) => void;
  reset: () => void;
}

const initialState = {
  taskId: null,
  phase: null,
  phaseMessage: null,
  completed: false,
  failed: false,
  error: null,
  images: [] as ImageStatus[],
  imageProgress: 0,
  imageTotal: 0,
  resultSlug: null,
  resultTitle: null,
  castMembers: [] as CastMember[],
  castRefUrls: {} as Record<string, string>,
  mainRefSheetUrl: null as string | null,
  waitingForStoryReview: false,
  waitingForCastReview: false,
  coverVariations: [] as CoverVariation[],
  waitingForCoverSelection: false,
  queuePosition: 0,
  queueAhead: 0,
  phaseData: {} as Record<string, Record<string, unknown>>,
  phaseStartTime: null as number | null,
  phaseElapsed: {} as Record<string, number>,
};

export const usePipelineStore = create<PipelineState>((set) => ({
  ...initialState,

  setTaskId: (id) => set({ ...initialState, taskId: id }),

  handleEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "queue_position":
          return {
            queuePosition: event.position ?? 0,
            queueAhead: event.queue_ahead ?? 0,
          };
        case "phase_start":
          return {
            phase: event.phase ?? null,
            phaseMessage: event.message ?? null,
            imageTotal: event.data?.total as number ?? state.imageTotal,
            phaseStartTime: Date.now(),
            queuePosition: 0,
            queueAhead: 0,
          };
        case "phase_complete": {
          const phase = event.phase;
          // Prefer server-authoritative elapsed time, fall back to client-side
          const startTime = state.phaseStartTime;
          const clientElapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : null;
          const elapsed = event.elapsed != null ? Math.round(event.elapsed as number) : clientElapsed;

          const updates: Partial<PipelineState> = {
            phaseMessage: null,
            phaseStartTime: null,
            resultSlug: event.data?.slug as string ?? state.resultSlug,
          };
          // Store per-phase completion data
          if (phase && event.data) {
            updates.phaseData = { ...state.phaseData, [phase]: event.data };
          }
          // Store per-phase elapsed time
          if (phase && elapsed != null) {
            updates.phaseElapsed = { ...state.phaseElapsed, [phase]: elapsed };
          }
          // Capture cast members when cast phase completes
          if (phase === "cast" && event.data?.members) {
            updates.castMembers = event.data.members as CastMember[];
          }
          // Capture main character reference sheet URL
          if (phase === "reference_sheet" && event.data?.url) {
            updates.mainRefSheetUrl = event.data.url as string;
          }
          return updates;
        }
        case "image_complete":
          return {
            images: [
              ...state.images,
              {
                page: event.page!,
                is_cover: event.is_cover!,
                url: event.url!,
                skipped: event.skipped!,
              },
            ],
            imageProgress: event.progress ?? state.imageProgress,
            imageTotal: event.total ?? state.imageTotal,
          };
        case "cast_ref_complete":
          return {
            castRefUrls: event.name && event.url
              ? { ...state.castRefUrls, [event.name]: event.url }
              : state.castRefUrls,
          };
        case "cover_variation_complete":
          return {
            coverVariations: [
              ...state.coverVariations,
              { index: event.index!, url: event.url! },
            ],
          };
        case "task_complete": {
          const result = event.result ?? {};
          const slug = (result.slug as string) ?? state.resultSlug;
          const hasKeyframes = !!(result.has_keyframes);
          const hasCast = state.castMembers.length > 0 || (result.cast_count as number) > 0;

          // Use cover variations from result as fallback if SSE events were missed
          const resultCovers = result.cover_variations as CoverVariation[] | undefined;
          const covers = resultCovers?.length ? resultCovers : state.coverVariations;

          // Capture cast ref URLs from result if available
          const resultCastRefUrls = result.cast_ref_urls as Array<{ name: string; url: string }> | undefined;
          const castRefUrlsFromResult: Record<string, string> = {};
          if (resultCastRefUrls) {
            for (const item of resultCastRefUrls) {
              if (item.url) castRefUrlsFromResult[item.name] = item.url;
            }
          }
          const mergedCastRefUrls = { ...state.castRefUrls, ...castRefUrlsFromResult };
          const mainRef = (result.reference_sheet_url as string) ?? state.mainRefSheetUrl;

          // If story+keyframes done but no cast yet, pause for story review
          const shouldWaitStory = hasKeyframes && !hasCast && state.images.length === 0 && covers.length === 0;
          // If cast present but no images, pause for cast review
          const shouldWaitCast = hasCast && state.images.length === 0 && covers.length === 0;
          // If cover variations were generated, pause for cover selection
          const shouldWaitCover = covers.length > 0;
          return {
            completed: true,
            resultSlug: slug,
            resultTitle: (result.title as string) ?? state.resultTitle,
            waitingForStoryReview: shouldWaitStory,
            waitingForCastReview: shouldWaitCast,
            waitingForCoverSelection: shouldWaitCover,
            coverVariations: covers,
            castRefUrls: mergedCastRefUrls,
            mainRefSheetUrl: mainRef,
          };
        }
        case "error":
          return { failed: true, error: event.error ?? "Unknown error" };
        default:
          return {};
      }
    }),

  restoreState: (data) => {
    // Determine which phase to mark as current so the timeline
    // shows prior phases as done (green checkmarks).
    // cast_reference_sheets comes after cast in the timeline, so if we have
    // cast ref URLs, mark that phase as the latest completed.
    const phase = data.waitingForCoverSelection
      ? "cover_variations"
      : data.waitingForCastReview
        ? "cast_reference_sheets"
        : data.waitingForStoryReview
          ? "keyframes"
          : null;
    set({
      ...initialState,
      taskId: null,
      phase,
      completed: true,
      resultSlug: data.slug,
      resultTitle: data.title ?? null,
      waitingForStoryReview: data.waitingForStoryReview ?? false,
      waitingForCastReview: data.waitingForCastReview ?? false,
      waitingForCoverSelection: data.waitingForCoverSelection ?? false,
      castMembers: data.castMembers ?? [],
      coverVariations: data.coverVariations ?? [],
      castRefUrls: data.castRefUrls ?? {},
      mainRefSheetUrl: data.mainRefSheetUrl ?? null,
    });
  },

  reset: () => set(initialState),
}));
