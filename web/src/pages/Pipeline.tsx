import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePipelineStore } from "../stores/pipelineStore";
import { useSSE } from "../hooks/useSSE";
import { PipelineTimeline } from "../components/PipelineTimeline";
import { CastReviewPanel } from "../components/CastReviewPanel";
import { CoverSelectionPanel } from "../components/CoverSelectionPanel";
import { updateStory, continuePipeline, selectCoverAndContinue } from "../api/client";
import type { CastMember } from "../api/types";

export function Pipeline() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    taskId, phase, phaseMessage, completed, failed, error,
    images, imageProgress, imageTotal, resultSlug,
    castMembers, waitingForCastReview,
    coverVariations, waitingForCoverSelection,
    phaseData, phaseElapsed, phaseStartTime,
    setTaskId, handleEvent, setWaitingForCastReview, setWaitingForCoverSelection,
  } = usePipelineStore();
  const [approving, setApproving] = useState(false);
  const [selectingCover, setSelectingCover] = useState(false);

  // Pick up taskId from navigation state (from NewStory page)
  useEffect(() => {
    const stateTaskId = (location.state as { taskId?: string } | null)?.taskId;
    if (stateTaskId && stateTaskId !== taskId) {
      setTaskId(stateTaskId);
    }
  }, [location.state, taskId, setTaskId]);

  useSSE(taskId, "/api/pipeline/progress", handleEvent);

  // Navigate to review on completion (but not if waiting for cast review or cover selection)
  useEffect(() => {
    if (completed && resultSlug && !waitingForCastReview && !waitingForCoverSelection) {
      const timer = setTimeout(() => {
        navigate(`/stories/${resultSlug}/review`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [completed, resultSlug, waitingForCastReview, waitingForCoverSelection, navigate]);

  const handleCastApprove = useCallback(async (cast: CastMember[]) => {
    if (!resultSlug) return;
    setApproving(true);
    try {
      // Save edited cast
      await updateStory(resultSlug, { cast });
      // Continue pipeline (translate → illustrate → backdrops → PDF)
      const res = await continuePipeline(resultSlug);
      setWaitingForCastReview(false);
      setTaskId(res.task_id);
    } catch (err) {
      console.error("Failed to continue pipeline:", err);
    } finally {
      setApproving(false);
    }
  }, [resultSlug, setTaskId, setWaitingForCastReview]);

  const handleCoverSelect = useCallback(async (choice: number) => {
    if (!resultSlug) return;
    setSelectingCover(true);
    try {
      const res = await selectCoverAndContinue(resultSlug, choice);
      setWaitingForCoverSelection(false);
      setTaskId(res.task_id);
    } catch (err) {
      console.error("Failed to continue after cover selection:", err);
    } finally {
      setSelectingCover(false);
    }
  }, [resultSlug, setTaskId, setWaitingForCoverSelection]);

  if (!taskId) {
    return (
      <div className="text-center py-20">
        <p className="text-bark-400">No active pipeline. Start by creating a new story.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-extrabold text-bark-800 mb-2">
        {waitingForCoverSelection
          ? "Choose Your Cover"
          : waitingForCastReview
            ? "Review Cast"
            : completed
              ? "Story Complete!"
              : "Creating Your Story"}
      </h1>
      <p className="text-sm text-bark-400 mb-8">
        {waitingForCoverSelection
          ? "Pick the cover art that best captures your story"
          : waitingForCastReview
            ? "Check character descriptions before illustrations begin"
            : completed
              ? "Redirecting to review..."
              : phaseMessage || "Preparing pipeline..."}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-bark-600 mb-4">Pipeline Progress</h2>
          <PipelineTimeline
            currentPhase={phase}
            completed={completed}
            failed={failed}
            waitingForCastReview={waitingForCastReview}
            waitingForCoverSelection={waitingForCoverSelection}
            phaseMessage={phaseMessage}
            phaseData={phaseData}
            phaseElapsed={phaseElapsed}
            phaseStartTime={phaseStartTime}
            imageProgress={imageProgress}
            imageTotal={imageTotal}
          />
        </div>

        {/* Active phase details + image grid / cast review */}
        <div className="lg:col-span-2 space-y-4">
          {/* Cast review panel */}
          {waitingForCastReview && (
            <CastReviewPanel
              initialCast={castMembers}
              onApprove={handleCastApprove}
              approving={approving}
            />
          )}

          {/* Cover selection panel */}
          {waitingForCoverSelection && (
            <CoverSelectionPanel
              slug={resultSlug || ""}
              variations={coverVariations}
              onSelect={handleCoverSelect}
              selecting={selectingCover}
            />
          )}

          {/* Image progress */}
          {(phase === "illustration" || images.length > 0) && !waitingForCastReview && !waitingForCoverSelection && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-bark-600">Illustrations</h2>
                <span className="text-xs text-bark-400">
                  {imageProgress}/{imageTotal}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-bark-100 rounded-full mb-4 overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-500"
                  style={{ width: `${imageTotal > 0 ? (imageProgress / imageTotal) * 100 : 0}%` }}
                />
              </div>

              {/* Image grid */}
              <div className="grid grid-cols-4 gap-2">
                {images.map((img) => (
                  <div
                    key={img.page}
                    className="aspect-square rounded-lg overflow-hidden bg-cream-dark relative"
                  >
                    <img
                      src={img.url}
                      alt={img.is_cover ? "Cover" : `Page ${img.page}`}
                      className="w-full h-full object-cover"
                    />
                    {img.is_cover && (
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-amber-500/90 text-white text-[8px] font-bold rounded">
                        Cover
                      </span>
                    )}
                  </div>
                ))}

                {/* Pending placeholders */}
                {imageTotal > 0 && Array.from({ length: imageTotal - images.length }).map((_, i) => (
                  <div key={`pending-${i}`} className="aspect-square rounded-lg bg-bark-100 animate-pulse" />
                ))}
              </div>
            </div>
          )}

          {/* Error display */}
          {failed && error && (
            <div className="bg-red-50 border border-red-200 rounded-[var(--radius-card)] p-5 text-sm text-red-700">
              <h3 className="font-bold mb-1">Pipeline Failed</h3>
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
