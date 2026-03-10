import { useState, useEffect } from "react";

const PHASES = [
  { key: "story", label: "Story Generation" },
  { key: "keyframes", label: "Page Keyframes" },
  { key: "cast", label: "Cast Extraction" },
  { key: "cast_rewrite", label: "Cast Consistency" },
  { key: "translation", label: "Translation" },
  { key: "reference_sheet", label: "Reference Sheet" },
  { key: "cover_variations", label: "Cover Options" },
  { key: "illustration", label: "Illustrations" },
  { key: "backdrops", label: "Backdrops" },
  { key: "pdf", label: "PDF Rendering" },
];

/* ─── Phase-specific icons (Heroicons outline, 24x24) ─── */

function PhaseIcon({ phaseKey }: { phaseKey: string }) {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "w-4 h-4",
  };
  switch (phaseKey) {
    case "story":
      return <svg {...p}><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>;
    case "keyframes":
      return <svg {...p}><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>;
    case "cast":
      return <svg {...p}><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0112.75 0v.109zM12 9.75a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>;
    case "cast_rewrite":
      return <svg {...p}><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>;
    case "translation":
      return <svg {...p}><path d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" /></svg>;
    case "reference_sheet":
      return <svg {...p}><path d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" /></svg>;
    case "cover_variations":
      return <svg {...p}><path d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21zM16.5 8.25a1.125 1.125 0 11-2.25 0 1.125 1.125 0 012.25 0z" /></svg>;
    case "illustration":
      return <svg {...p}><path d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" /></svg>;
    case "backdrops":
      return <svg {...p}><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>;
    case "pdf":
      return <svg {...p}><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>;
    default:
      return null;
  }
}

/* ─── Helpers ─── */

function formatPhaseDetail(key: string, data: Record<string, unknown>): string | null {
  switch (key) {
    case "story":
      return data.word_count ? `${Number(data.word_count).toLocaleString()} words crafted` : null;
    case "keyframes":
      return data.page_count ? `${data.page_count} pages structured` : null;
    case "cast":
      return data.cast_count
        ? `${data.cast_count} character${Number(data.cast_count) !== 1 ? "s" : ""} identified`
        : null;
    case "cast_rewrite":
      return "Scene descriptions updated";
    case "translation":
      return data.translated_title ? `"${data.translated_title}"` : null;
    case "reference_sheet":
      return data.generated ? "Character sheet ready" : "Skipped";
    case "cover_variations":
      return data.count ? `${data.count} options created` : null;
    case "illustration":
      return "All pages illustrated";
    case "backdrops":
      return data.count ? `${data.count} backgrounds painted` : null;
    case "pdf":
      return "Book rendered";
    default:
      return null;
  }
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/* ─── Component ─── */

interface PipelineTimelineProps {
  currentPhase: string | null;
  completed: boolean;
  failed: boolean;
  waitingForCastReview?: boolean;
  waitingForCoverSelection?: boolean;
  phaseMessage?: string | null;
  phaseData?: Record<string, Record<string, unknown>>;
  phaseElapsed?: Record<string, number>;
  phaseStartTime?: number | null;
  imageProgress?: number;
  imageTotal?: number;
}

export function PipelineTimeline({
  currentPhase,
  completed,
  failed,
  waitingForCastReview,
  waitingForCoverSelection,
  phaseMessage,
  phaseData = {},
  phaseElapsed = {},
  phaseStartTime,
  imageProgress = 0,
  imageTotal = 0,
}: PipelineTimelineProps) {
  const currentIdx = PHASES.findIndex((p) => p.key === currentPhase);
  const isWaitingAny = waitingForCastReview || waitingForCoverSelection;

  // Live elapsed timer for the active phase
  const [liveElapsed, setLiveElapsed] = useState(0);
  useEffect(() => {
    if (!phaseStartTime || completed || failed) {
      setLiveElapsed(0);
      return;
    }
    setLiveElapsed(Math.floor((Date.now() - phaseStartTime) / 1000));
    const interval = setInterval(() => {
      setLiveElapsed(Math.floor((Date.now() - phaseStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phaseStartTime, completed, failed]);

  // Overall progress
  const totalPhases = PHASES.length;
  const doneCount = completed && !isWaitingAny ? totalPhases : Math.max(0, currentIdx);
  const progressPct = Math.round((doneCount / totalPhases) * 100);

  return (
    <div>
      {/* Overall progress header */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-bark-400">
            {completed && !isWaitingAny
              ? "Complete"
              : currentIdx >= 0
                ? `Step ${currentIdx + 1} of ${totalPhases}`
                : "Preparing\u2026"}
          </span>
          <span className="text-[11px] font-bold text-bark-400 tabular-nums">{progressPct}%</span>
        </div>
        <div className="h-1.5 bg-bark-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              completed && !isWaitingAny ? "" : "tl-shimmer"
            }`}
            style={{
              width: `${progressPct}%`,
              background:
                completed && !isWaitingAny
                  ? "var(--color-sage-400)"
                  : "linear-gradient(90deg, var(--color-sage-400), var(--color-amber-400, #f59e0b))",
            }}
          />
        </div>
      </div>

      {/* Phase timeline */}
      <div className="relative">
        {PHASES.map((phase, i) => {
          const isDone = currentIdx > i || (completed && !isWaitingAny);
          const isActive = currentIdx === i && !completed && !failed;
          const isWaiting =
            (waitingForCastReview && phase.key === "cast" && completed) ||
            (waitingForCoverSelection && phase.key === "cover_variations" && completed);
          const isFailed = failed && currentIdx === i;
          const isPending = !isDone && !isActive && !isWaiting && !isFailed;

          const detail =
            isDone && phaseData[phase.key]
              ? formatPhaseDetail(phase.key, phaseData[phase.key])
              : null;
          const elapsed = phaseElapsed[phase.key];

          // Connector line color (segment below this node)
          const nextPhase = PHASES[i + 1];
          const nextIdx = i + 1;
          const nextIsDone = nextPhase && (currentIdx > nextIdx || (completed && !isWaitingAny));
          const nextIsActive = nextPhase && currentIdx === nextIdx && !completed && !failed;

          let lineClass = "bg-bark-100";
          if (isDone && (nextIsDone || nextIsActive)) {
            lineClass = "bg-sage-300";
          } else if (isDone) {
            lineClass = "bg-bark-200";
          }

          const isLast = i === PHASES.length - 1;

          return (
            <div key={phase.key} className="relative flex gap-3.5">
              {/* Connector line segment (below node to next node) */}
              {!isLast && (
                <div
                  className={`absolute left-[17px] top-[38px] bottom-0 w-[2px] rounded-full transition-colors duration-500 ${lineClass}`}
                />
              )}

              {/* Node circle with effects */}
              <div className="relative z-10 shrink-0 pt-0.5">
                {/* Ripple rings for active & waiting states */}
                {isActive && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-amber-400/30 tl-ripple" />
                    <div className="absolute inset-0 rounded-full bg-amber-400/20 tl-ripple-delayed" />
                  </>
                )}
                {isWaiting && (
                  <div className="absolute inset-0 rounded-full bg-amber-400/25 tl-ripple" />
                )}

                <div
                  className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isFailed
                      ? "bg-red-100 text-red-500 ring-2 ring-red-200"
                      : isWaiting
                        ? "bg-amber-100 text-amber-600 ring-2 ring-amber-300"
                        : isDone
                          ? "bg-sage-500 text-white shadow-sm"
                          : isActive
                            ? "bg-amber-400 text-amber-900 shadow-lg shadow-amber-300/30 tl-glow"
                            : "bg-bark-100 text-bark-300"
                  }`}
                >
                  {isDone && !isWaiting ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  ) : isFailed ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  ) : (
                    <PhaseIcon phaseKey={phase.key} />
                  )}
                </div>
              </div>

              {/* Content */}
              <div className={`flex-1 pt-1.5 ${isLast ? "pb-0" : "pb-5"}`}>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold transition-colors duration-300 ${
                      isFailed
                        ? "text-red-600"
                        : isWaiting
                          ? "text-amber-700"
                          : isDone
                            ? "text-bark-700"
                            : isActive
                              ? "text-bark-800"
                              : "text-bark-300"
                    }`}
                  >
                    {phase.label}
                  </span>

                  {/* Elapsed time badges */}
                  {isDone && elapsed != null && !isWaiting && (
                    <span className="text-[10px] text-bark-300 tabular-nums font-medium tl-fade-in">
                      {formatElapsed(elapsed)}
                    </span>
                  )}
                  {isActive && liveElapsed > 0 && (
                    <span className="text-[10px] text-amber-500/70 tabular-nums font-medium">
                      {formatElapsed(liveElapsed)}
                    </span>
                  )}
                </div>

                {/* Active: phase message */}
                {isActive && phaseMessage && (
                  <p className="text-xs text-amber-600/80 mt-0.5 tl-fade-in">{phaseMessage}</p>
                )}

                {/* Active illustration: inline progress bar */}
                {isActive && phase.key === "illustration" && imageTotal > 0 && (
                  <div className="mt-2 tl-fade-in">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-bark-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full transition-all duration-500"
                          style={{ width: `${(imageProgress / imageTotal) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-bark-400 tabular-nums shrink-0">
                        {imageProgress}/{imageTotal}
                      </span>
                    </div>
                  </div>
                )}

                {/* Waiting: action badge */}
                {isWaiting && (
                  <span className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold tl-fade-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {phase.key === "cast" ? "Review needed" : "Selection needed"}
                  </span>
                )}

                {/* Done: contextual detail */}
                {isDone && detail && !isWaiting && (
                  <p className="text-[11px] text-bark-400 mt-0.5 tl-fade-in">{detail}</p>
                )}

                {/* Failed: error hint */}
                {isFailed && (
                  <p className="text-xs text-red-500 mt-0.5 tl-fade-in">
                    Pipeline failed at this step
                  </p>
                )}

                {/* Pending: subtle indicator for next-up phase */}
                {isPending && currentIdx === i - 1 && !completed && !failed && (
                  <p className="text-[10px] text-bark-300 mt-0.5">Up next</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
