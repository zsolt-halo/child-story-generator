import { create } from "zustand";
import type { SSEEvent, CastMember } from "../api/types";

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

  setTaskId: (id: string) => void;
  handleEvent: (event: SSEEvent) => void;
  setWaitingForCastReview: (v: boolean) => void;
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
};

export const usePipelineStore = create<PipelineState>((set) => ({
  ...initialState,

  setTaskId: (id) => set({ ...initialState, taskId: id }),

  handleEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "phase_start":
          return {
            phase: event.phase ?? null,
            phaseMessage: event.message ?? null,
            imageTotal: event.data?.total as number ?? state.imageTotal,
          };
        case "phase_complete": {
          const updates: Partial<PipelineState> = {
            phaseMessage: null,
            resultSlug: event.data?.slug as string ?? state.resultSlug,
          };
          // Capture cast members when cast phase completes
          if (event.phase === "cast" && event.data?.members) {
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
        case "task_complete": {
          const slug = (event.result?.slug as string) ?? state.resultSlug;
          const hasCast = state.castMembers.length > 0;
          // If this was a story-only task (cast present, no images), pause for cast review
          const shouldWait = hasCast && state.images.length === 0;
          return {
            completed: true,
            resultSlug: slug,
            resultTitle: (event.result?.title as string) ?? state.resultTitle,
            waitingForCastReview: shouldWait,
          };
        }
        case "error":
          return { failed: true, error: event.error ?? "Unknown error" };
        default:
          return {};
      }
    }),

  setWaitingForCastReview: (v) => set({ waitingForCastReview: v }),

  reset: () => set(initialState),
}));
