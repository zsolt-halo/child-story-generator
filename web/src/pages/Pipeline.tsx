import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePipelineStore } from "../stores/pipelineStore";
import { useSSE } from "../hooks/useSSE";
import { PipelineTimeline } from "../components/PipelineTimeline";
import { CastReviewPanel } from "../components/CastReviewPanel";
import { CoverSelectionPanel } from "../components/CoverSelectionPanel";
import { updateStory, continuePipeline, selectCoverAndContinue, startCastExtraction, getPhaseAverages, getStory } from "../api/client";
import { StoryReviewPanel } from "../components/StoryReviewPanel";
import { FadeImage } from "../components/FadeImage";
import type { CastMember } from "../api/types";

export function Pipeline() {
  const navigate = useNavigate();
  const location = useLocation();
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const {
    taskId, phase, phaseMessage, completed, failed, error,
    images, imageProgress, imageTotal, resultSlug,
    castMembers, castRefUrls, mainRefSheetUrl,
    waitingForStoryReview, waitingForCastReview,
    coverVariations, waitingForCoverSelection,
    queuePosition, queueAhead,
    phaseData, phaseElapsed, phaseStartTime,
    setTaskId, handleEvent, restoreState,
  } = usePipelineStore();
  const [approvingStory, setApprovingStory] = useState(false);
  const [approving, setApproving] = useState(false);
  const [selectingCover, setSelectingCover] = useState(false);
  const { data: phaseAverages = {} } = useQuery({
    queryKey: ["phaseAverages"],
    queryFn: getPhaseAverages,
    staleTime: 60_000,
  });

  // Pick up taskId from navigation state (from NewStory page) — consume only once
  // If navigating with a route slug but no fresh taskId, reset store for recovery
  const consumedStateRef = useRef(false);
  useEffect(() => {
    if (consumedStateRef.current) return;
    consumedStateRef.current = true;
    const stateTaskId = (location.state as { taskId?: string } | null)?.taskId;
    if (stateTaskId) {
      setTaskId(stateTaskId);
    } else if (routeSlug && taskId) {
      // Stale taskId in store (e.g. container restart) — reset to allow recovery
      usePipelineStore.getState().reset();
    }
  }, [location.state, setTaskId, routeSlug, taskId]);

  useSSE(taskId, "/api/pipeline/progress", handleEvent);

  // Recover state from DB when we have a route slug but no active task
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current || taskId || !routeSlug) return;
    // Don't recover if we already have a waiting state (store is populated)
    if (waitingForStoryReview || waitingForCastReview || waitingForCoverSelection) return;
    recoveredRef.current = true;

    getStory(routeSlug).then((detail) => {
      const { story, image_urls, cover_variation_urls } = detail;
      const hasKeyframes = story.keyframes.length > 0;
      const hasCast = story.cast.length > 0;
      const hasImages = Object.keys(image_urls).length > 0;
      const hasCoverVariations = cover_variation_urls.length > 0;

      // Determine which pause point the story is at
      if (hasCoverVariations && !hasImages) {
        restoreState({
          slug: routeSlug,
          title: story.title,
          waitingForCoverSelection: true,
          coverVariations: cover_variation_urls.map((url, i) => ({ index: i + 1, url })),
        });
      } else if (hasCast && !hasImages) {
        restoreState({
          slug: routeSlug,
          title: story.title,
          waitingForCastReview: true,
          castMembers: story.cast,
          castRefUrls: detail.cast_ref_urls ?? {},
          mainRefSheetUrl: detail.reference_sheet_url ?? null,
        });
      } else if (hasKeyframes && !hasCast) {
        restoreState({
          slug: routeSlug,
          title: story.title,
          waitingForStoryReview: true,
        });
      }
      // If has images, it's complete — navigate to review
      else if (hasImages) {
        navigate(`/stories/${routeSlug}/review`, { replace: true });
      }
    }).catch((err) => {
      console.error("Failed to recover pipeline state:", err);
    });
  }, [routeSlug, taskId, waitingForStoryReview, waitingForCastReview, waitingForCoverSelection, restoreState, navigate]);

  const handleStoryApprove = useCallback(async () => {
    if (!resultSlug) return;
    setApprovingStory(true);
    try {
      const res = await startCastExtraction(resultSlug);
      setTaskId(res.task_id);
    } catch (err) {
      console.error("Failed to start cast extraction:", err);
    } finally {
      setApprovingStory(false);
    }
  }, [resultSlug, setTaskId]);

  // Navigate to review on completion (but not if waiting for any review step)
  useEffect(() => {
    if (completed && resultSlug && !waitingForStoryReview && !waitingForCastReview && !waitingForCoverSelection) {
      const timer = setTimeout(() => {
        navigate(`/stories/${resultSlug}/review`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [completed, resultSlug, waitingForStoryReview, waitingForCastReview, waitingForCoverSelection, navigate]);

  const handleCastApprove = useCallback(async (cast: CastMember[]) => {
    if (!resultSlug) return;
    setApproving(true);
    try {
      // Detect whether the user actually changed anything
      const castEdited = JSON.stringify(cast) !== JSON.stringify(castMembers);
      // Save edited cast
      await updateStory(resultSlug, { cast });
      // Continue pipeline (translate → ref sheet → cover variations → pause)
      const res = await continuePipeline(resultSlug, castEdited);
      // setTaskId resets entire store (including waitingForCastReview)
      setTaskId(res.task_id);
    } catch (err) {
      console.error("Failed to continue pipeline:", err);
    } finally {
      setApproving(false);
    }
  }, [resultSlug, castMembers, setTaskId]);

  const handleCoverSelect = useCallback(async (choice: number) => {
    if (!resultSlug) return;
    setSelectingCover(true);
    try {
      const res = await selectCoverAndContinue(resultSlug, choice);
      // setTaskId resets entire store (including waitingForCoverSelection)
      setTaskId(res.task_id);
    } catch (err) {
      console.error("Failed to continue after cover selection:", err);
    } finally {
      setSelectingCover(false);
    }
  }, [resultSlug, setTaskId]);

  const isQueued = queuePosition > 0;

  // Show empty state only if we have no task, no recovered state, and no route slug to recover from
  const hasRestoredState = waitingForStoryReview || waitingForCastReview || waitingForCoverSelection;
  if (!taskId && !hasRestoredState && !routeSlug) {
    return (
      <div className="text-center py-20">
        <p className="text-bark-400">No active pipeline. Start by creating a new story.</p>
      </div>
    );
  }

  // Show loading while recovering state from DB
  const isRecovering = !taskId && !hasRestoredState && !!routeSlug;

  const isWideLayout = waitingForStoryReview || waitingForCastReview;

  return (
    <div className={`mx-auto ${isWideLayout ? "max-w-5xl" : "max-w-3xl"}`}>
      <h1 className="text-2xl font-extrabold text-bark-800 mb-2">
        {isQueued
          ? "Your Story Is in Line"
          : waitingForStoryReview
            ? "Review Your Story"
            : waitingForCoverSelection
              ? "Choose Your Cover"
              : waitingForCastReview
                ? "Review Cast"
                : completed
                  ? "Story Complete!"
                  : isRecovering
                    ? "Resuming..."
                    : "Creating Your Story"}
      </h1>
      <p className="text-sm text-bark-400 mb-8">
        {isQueued
          ? "Hang tight \u2014 we'll start as soon as it's your turn"
          : waitingForStoryReview
            ? "Check your story flow before we find the characters"
            : waitingForCoverSelection
              ? "Pick the cover art that best captures your story"
              : waitingForCastReview
                ? "Check character descriptions before illustrations begin"
                : completed
                  ? "Redirecting to review..."
                  : isRecovering
                    ? "Loading your story..."
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
            waitingForStoryReview={waitingForStoryReview}
            waitingForCastReview={waitingForCastReview}
            waitingForCoverSelection={waitingForCoverSelection}
            phaseMessage={phaseMessage}
            phaseData={phaseData}
            phaseElapsed={phaseElapsed}
            phaseStartTime={phaseStartTime}
            imageProgress={imageProgress}
            imageTotal={imageTotal}
            phaseAverages={phaseAverages}
          />
        </div>

        {/* Active phase details + image grid / cast review */}
        <div className="lg:col-span-2 space-y-4">
          {/* Queue position indicator */}
          {isQueued && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-8 shadow-sm text-center">
              <div className="queue-float inline-block mb-5">
                <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                  <svg
                    className="w-8 h-8 text-amber-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                    />
                  </svg>
                </div>
              </div>

              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 mb-4">
                <span className="text-2xl font-extrabold text-amber-600 tabular-nums font-heading">
                  {queueAhead}
                </span>
                <span className="text-sm text-amber-700 font-medium">
                  {queueAhead === 1 ? "story ahead of yours" : "stories ahead of yours"}
                </span>
              </div>

              <p className="text-bark-500 text-sm leading-relaxed max-w-xs mx-auto mb-5">
                Another story is being illustrated right now.
                Yours will begin automatically when it's next in line.
              </p>

              <div className="flex items-center justify-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 queue-dot-1" />
                <div className="w-2 h-2 rounded-full bg-amber-400 queue-dot-2" />
                <div className="w-2 h-2 rounded-full bg-amber-400 queue-dot-3" />
              </div>
            </div>
          )}

          {/* Cast review panel */}
          {waitingForCastReview && resultSlug && (
            <CastReviewPanel
              slug={resultSlug}
              initialCast={castMembers}
              castRefUrls={castRefUrls}
              mainRefSheetUrl={mainRefSheetUrl}
              onApprove={handleCastApprove}
              approving={approving}
            />
          )}

          {/* Cover selection panel */}
          {waitingForCoverSelection && (
            <CoverSelectionPanel
              variations={coverVariations}
              onSelect={handleCoverSelect}
              selecting={selectingCover}
            />
          )}

          {/* Reference sheet preview */}
          {typeof phaseData.reference_sheet?.url === "string" && !waitingForCastReview && !waitingForCoverSelection && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm tl-fade-in">
              <h2 className="text-sm font-bold text-bark-600 mb-3">Character Reference Sheet</h2>
              <div className="rounded-lg overflow-hidden border border-bark-100">
                <FadeImage
                  src={phaseData.reference_sheet.url as string}
                  thumbWidth={600}
                  alt="Character reference sheet"
                  className="w-full"
                />
              </div>
              <p className="text-[11px] text-bark-400 mt-2">
                This model sheet guides all illustrations for character consistency.
              </p>
            </div>
          )}

          {/* Image progress */}
          {(phase === "illustration" || images.length > 0) && !waitingForStoryReview && !waitingForCastReview && !waitingForCoverSelection && (
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
                    <FadeImage
                      src={img.url}
                      thumbWidth={400}
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

      {/* Story review panel — full width below the grid */}
      {waitingForStoryReview && resultSlug && (
        <div className="mt-6">
          <StoryReviewPanel
            slug={resultSlug}
            onApprove={handleStoryApprove}
            approving={approvingStory}
          />
        </div>
      )}
    </div>
  );
}
