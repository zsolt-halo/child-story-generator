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
          const startTime = state.phaseStartTime;
          const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : null;

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
          const hasCast = state.castMembers.length > 0 || (result.cast_count as number) > 0;

          // Use cover variations from result as fallback if SSE events were missed
          const resultCovers = result.cover_variations as CoverVariation[] | undefined;
          const covers = resultCovers?.length ? resultCovers : state.coverVariations;

          // If this was a story-only task (cast present, no images), pause for cast review
          const shouldWaitCast = hasCast && state.images.length === 0 && covers.length === 0;
          // If cover variations were generated, pause for cover selection
          const shouldWaitCover = covers.length > 0;
          return {
            completed: true,
            resultSlug: slug,
            resultTitle: (result.title as string) ?? state.resultTitle,
            waitingForCastReview: shouldWaitCast,
            waitingForCoverSelection: shouldWaitCover,
            coverVariations: covers,
          };
        }
        case "error":
          return { failed: true, error: event.error ?? "Unknown error" };
        default:
          return {};
      }
    }),

  reset: () => set(initialState),
}));
