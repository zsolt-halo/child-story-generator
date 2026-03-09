const PHASES = [
  { key: "story", label: "Story Generation" },
  { key: "keyframes", label: "Page Keyframes" },
  { key: "cast", label: "Cast Extraction" },
  { key: "translation", label: "Translation" },
  { key: "illustration", label: "Illustrations" },
  { key: "backdrops", label: "Backdrops" },
  { key: "pdf", label: "PDF Rendering" },
];

interface PipelineTimelineProps {
  currentPhase: string | null;
  completed: boolean;
  failed: boolean;
  waitingForCastReview?: boolean;
}

export function PipelineTimeline({ currentPhase, completed, failed, waitingForCastReview }: PipelineTimelineProps) {
  const currentIdx = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="space-y-1">
      {PHASES.map((phase, i) => {
        const isDone = currentIdx > i || (completed && !waitingForCastReview);
        const isActive = currentIdx === i && !completed && !failed;
        const isWaiting = waitingForCastReview && phase.key === "cast" && completed;

        return (
          <div key={phase.key} className="flex items-center gap-3">
            {/* Indicator */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
              isWaiting
                ? "bg-amber-400 text-bark-800 animate-pulse"
                : isDone
                  ? "bg-sage-500 text-white"
                  : isActive
                    ? "bg-amber-400 text-bark-800 animate-pulse"
                    : "bg-bark-100 text-bark-400"
            }`}>
              {isDone && !isWaiting ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                i + 1
              )}
            </div>

            {/* Label */}
            <span className={`text-sm font-medium ${
              isWaiting ? "text-amber-700"
                : isDone ? "text-sage-600"
                  : isActive ? "text-amber-700" : "text-bark-300"
            }`}>
              {phase.label}
              {isActive && (
                <span className="ml-2 text-xs text-bark-400 font-normal">Running...</span>
              )}
              {isWaiting && (
                <span className="ml-2 text-xs text-amber-600 font-normal">Review needed</span>
              )}
            </span>
          </div>
        );
      })}

      {failed && (
        <div className="flex items-center gap-3 mt-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500 text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <span className="text-sm font-medium text-red-600">Failed</span>
        </div>
      )}
    </div>
  );
}
