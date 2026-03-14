import { create } from "zustand";
import type { SSEEvent, CastMember, CoverVariation } from "../api/types";

interface ImageStatus {
  page: number;
  is_cover: boolean;
  url: string;
  skipped: boolean;
}

interface VideoStatus {
  page: number;
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
  videos: VideoStatus[];
  videoProgress: number;
  videoTotal: number;
  isAnimationPipeline: boolean;
  resultSlug: string | null;
  resultTitle: string | null;
  castMembers: CastMember[];
  castRefUrls: Record<string, string>;
  mainRefSheetUrl: string | null;
  coverVariations: CoverVariation[];
  queuePosition: number;
  queueAhead: number;

  // Unified review gate — replaces separate story/cast/cover waiting states
  waitingForReview: boolean;
  // Legacy compat — these derived from waitingForReview for PipelineTimeline
  waitingForStoryReview: boolean;
  waitingForCastReview: boolean;
  waitingForCoverSelection: boolean;

  // Phase timing & detail tracking
  phaseData: Record<string, Record<string, unknown>>;
  phaseStartTime: number | null;
  phaseElapsed: Record<string, number>;

  setTaskId: (id: string) => void;
  handleEvent: (event: SSEEvent) => void;
  restoreState: (data: {
    slug: string;
    title?: string;
    waitingForReview?: boolean;
    // Legacy fields for recovery from old pipeline states
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
  videos: [] as VideoStatus[],
  videoProgress: 0,
  videoTotal: 0,
  isAnimationPipeline: false,
  resultSlug: null,
  resultTitle: null,
  castMembers: [] as CastMember[],
  castRefUrls: {} as Record<string, string>,
  mainRefSheetUrl: null as string | null,
  coverVariations: [] as CoverVariation[],
  waitingForReview: false,
  waitingForStoryReview: false,
  waitingForCastReview: false,
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
        case "phase_start": {
          const isAnim = event.phase === "animation" || state.isAnimationPipeline;
          return {
            phase: event.phase ?? null,
            phaseMessage: event.message ?? null,
            imageTotal: event.data?.total as number ?? state.imageTotal,
            videoTotal: isAnim ? (event.data?.total as number ?? state.videoTotal) : state.videoTotal,
            isAnimationPipeline: isAnim,
            phaseStartTime: Date.now(),
            queuePosition: 0,
            queueAhead: 0,
          };
        }
        case "phase_complete": {
          const phase = event.phase;
          const startTime = state.phaseStartTime;
          const clientElapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : null;
          const elapsed = event.elapsed != null ? Math.round(event.elapsed as number) : clientElapsed;

          const updates: Partial<PipelineState> = {
            phaseMessage: null,
            phaseStartTime: null,
            resultSlug: event.data?.slug as string ?? state.resultSlug,
          };
          if (phase && event.data) {
            updates.phaseData = { ...state.phaseData, [phase]: event.data };
          }
          if (phase && elapsed != null) {
            updates.phaseElapsed = { ...state.phaseElapsed, [phase]: elapsed };
          }
          if (phase === "cast" && event.data?.members) {
            updates.castMembers = event.data.members as CastMember[];
          }
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
        case "video_complete":
          return {
            videos: [
              ...state.videos,
              {
                page: event.page!,
                url: event.url!,
                skipped: event.skipped ?? false,
              },
            ],
            videoProgress: event.progress ?? state.videoProgress,
            videoTotal: event.total ?? state.videoTotal,
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

          // Unified review gate: if cover variations exist, pause for review
          const shouldWaitForReview = covers.length > 0 && state.images.length === 0;

          return {
            completed: true,
            resultSlug: slug,
            resultTitle: (result.title as string) ?? state.resultTitle,
            waitingForReview: shouldWaitForReview,
            // Set legacy flags for PipelineTimeline compatibility
            waitingForStoryReview: false,
            waitingForCastReview: false,
            waitingForCoverSelection: shouldWaitForReview,
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
    // Determine which phase to mark as current for timeline
    const isReview = data.waitingForReview || data.waitingForCoverSelection || data.waitingForCastReview || data.waitingForStoryReview;
    const phase = isReview ? "cover_variations" : null;
    set({
      ...initialState,
      taskId: null,
      phase,
      completed: true,
      resultSlug: data.slug,
      resultTitle: data.title ?? null,
      waitingForReview: isReview ?? false,
      // Legacy compat
      waitingForStoryReview: false,
      waitingForCastReview: false,
      waitingForCoverSelection: isReview ?? false,
      castMembers: data.castMembers ?? [],
      coverVariations: data.coverVariations ?? [],
      castRefUrls: data.castRefUrls ?? {},
      mainRefSheetUrl: data.mainRefSheetUrl ?? null,
    });
  },

  reset: () => set(initialState),
}));
