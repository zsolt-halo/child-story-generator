import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePipelineStore } from "../stores/pipelineStore";

const PHASE_LABELS: Record<string, string> = {
  premise: "Imagining a Story",
  story: "Writing Your Story",
  keyframes: "Planning the Pages",
  cast: "Meeting the Characters",
  reference_sheet: "Drawing the Hero",
  cast_references: "Drawing the Cast",
  cast_consistency: "Polishing the Scenes",
  translation: "Speaking Your Language",
  cover_variations: "Designing the Cover",
  illustration: "Painting Every Page",
  pdf: "Binding the Book",
};

const PHASE_ICONS: Record<string, string> = {
  premise: "\u2728",
  story: "\u270F\uFE0F",
  keyframes: "\uD83D\uDCCB",
  cast: "\uD83C\uDFAD",
  reference_sheet: "\uD83D\uDD8C\uFE0F",
  cast_references: "\uD83C\uDFA8",
  cast_consistency: "\u2728",
  translation: "\uD83C\uDF10",
  cover_variations: "\uD83D\uDCD6",
  illustration: "\uD83D\uDDBC\uFE0F",
  pdf: "\uD83D\uDCD5",
};

const AUTO_DISMISS_MS = 5000;

export function PipelineMiniTracker(): React.ReactElement | null {
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCompleted = useRef(false);

  const {
    taskId,
    phase,
    phaseMessage,
    completed,
    failed,
    error,
    imageProgress,
    imageTotal,
    resultSlug,
    resultTitle,
    waitingForReview,
    queuePosition,
  } = usePipelineStore();

  const isOnPipelinePage = /\/stories\/[^/]+\/pipeline/.test(
    location.pathname,
  );

  const hasActivity =
    taskId !== null || waitingForReview || completed || failed;

  // Auto-dismiss 5 seconds after completion
  useEffect(() => {
    if (completed && !prevCompleted.current) {
      autoDismissTimer.current = setTimeout(() => {
        setDismissed(true);
      }, AUTO_DISMISS_MS);
    }
    prevCompleted.current = completed;

    return () => {
      if (autoDismissTimer.current) {
        clearTimeout(autoDismissTimer.current);
      }
    };
  }, [completed]);

  // Reset dismissed state when a new task starts
  useEffect(() => {
    if (taskId) {
      setDismissed(false);
    }
  }, [taskId]);

  if (!hasActivity || isOnPipelinePage || dismissed) {
    return null;
  }

  const phaseLabel = phase ? (PHASE_LABELS[phase] ?? phase) : "Starting...";
  const phaseIcon = phase ? (PHASE_ICONS[phase] ?? "\u23F3") : "\u23F3";
  const pipelinePath = resultSlug
    ? `/stories/${resultSlug}/pipeline`
    : undefined;
  const illustrationPercent =
    phase === "illustration" && imageTotal > 0
      ? Math.round((imageProgress / imageTotal) * 100)
      : null;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 w-80 overflow-hidden border border-bark-100 bg-white shadow-lg"
      style={{ borderRadius: "var(--radius-card, 12px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bark-50 px-4 py-2.5">
        <span
          className="truncate text-sm font-medium text-bark-700"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {resultTitle ?? "Pipeline"}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded text-bark-400 transition-colors hover:bg-bark-50 hover:text-bark-600"
          aria-label="Dismiss tracker"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {/* Queued state */}
        {queuePosition > 0 && !completed && !failed && !waitingForReview && (
          <div className="flex items-center gap-2 text-sm text-bark-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            <span>Queued (position {queuePosition})</span>
          </div>
        )}

        {/* Failed state */}
        {failed && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-red-600">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              <span>Generation Failed</span>
            </div>
            {error && (
              <p className="line-clamp-2 text-xs text-red-500">{error}</p>
            )}
            {pipelinePath && (
              <Link
                to={pipelinePath}
                className="text-xs font-medium text-red-600 underline decoration-red-300 underline-offset-2 hover:text-red-700"
              >
                View Details
              </Link>
            )}
          </div>
        )}

        {/* Waiting for review */}
        {!failed && waitingForReview && pipelinePath && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-amber-700">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              <span className="font-medium">Waiting for Review</span>
            </div>
            <Link
              to={pipelinePath}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
            >
              Review Now
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 2l4 4-4 4" />
              </svg>
            </Link>
          </div>
        )}

        {/* Completed */}
        {!failed && !waitingForReview && completed && resultSlug && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-sage-700">
              <span className="inline-block h-2 w-2 rounded-full bg-sage-500" />
              <span>Book Ready!</span>
            </div>
            <Link
              to={`/stories/${resultSlug}?tab=illustrations`}
              className="inline-flex items-center gap-1.5 rounded-md bg-sage-50 px-3 py-1.5 text-xs font-semibold text-sage-700 transition-colors hover:bg-sage-100"
            >
              View Book
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 2l4 4-4 4" />
              </svg>
            </Link>
          </div>
        )}

        {/* Active / in-progress state */}
        {!failed &&
          !waitingForReview &&
          !completed &&
          queuePosition === 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="shrink-0" aria-hidden="true">
                  {phaseIcon}
                </span>
                <span className="truncate font-medium text-bark-700">
                  {phaseLabel}
                </span>
              </div>

              {phaseMessage && (
                <p className="truncate text-xs text-bark-400">
                  {phaseMessage}
                </p>
              )}

              {/* Illustration progress bar */}
              {illustrationPercent !== null && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bark-100">
                    <div
                      className="h-full rounded-full bg-sage-500 transition-all duration-500 ease-out"
                      style={{ width: `${illustrationPercent}%` }}
                    />
                  </div>
                  <p className="text-xs text-bark-400">
                    {imageProgress} of {imageTotal} pages
                  </p>
                </div>
              )}

              {/* Indeterminate progress for non-illustration phases */}
              {illustrationPercent === null && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bark-100">
                  <div className="tl-shimmer h-full w-full rounded-full" />
                </div>
              )}

              {pipelinePath && (
                <Link
                  to={pipelinePath}
                  className="text-xs font-medium text-bark-500 underline decoration-bark-200 underline-offset-2 hover:text-bark-700"
                >
                  View Details
                </Link>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
