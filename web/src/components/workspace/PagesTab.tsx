import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { updateStory, startIllustrate, startIllustratePage, startTranslate, startAnimate, getWorkerStatus } from "../../api/client";
import { KeyframeCard } from "../KeyframeCard";
import { PageEditorDrawer } from "../PageEditorDrawer";
import { CastReviewPanel } from "../CastReviewPanel";
import { usePipelineStore } from "../../stores/pipelineStore";
import type { StoryDetail, CastMember } from "../../api/types";

interface PagesTabProps {
  slug: string;
  data: StoryDetail;
  invalidate: () => void;
}

export function PagesTab({ slug, data, invalidate }: PagesTabProps) {
  const navigate = useNavigate();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [showCastEditor, setShowCastEditor] = useState(false);
  const [savingCast, setSavingCast] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateLang, setTranslateLang] = useState("");
  const [animating, setAnimating] = useState(false);

  const { data: workerStatus } = useQuery({
    queryKey: ["worker-status"],
    queryFn: getWorkerStatus,
    staleTime: 30_000,
  });

  const selectedKeyframe = data.story.keyframes.find((kf) => kf.page_number === selectedPage) ?? null;

  const handleSave = useCallback(
    async (pageNumber: number, updates: { page_text?: string; visual_description?: string; mood?: string }) => {
      await updateStory(slug, { keyframes: { [pageNumber]: updates } });
      invalidate();
    },
    [slug, invalidate],
  );

  const handleRegenerate = useCallback(
    async (pageNumber: number) => {
      const res = await startIllustratePage(slug, pageNumber);
      setTaskId(res.task_id);
    },
    [slug, setTaskId],
  );

  const handleIllustrate = async () => {
    const res = await startIllustrate(slug);
    setTaskId(res.task_id);
  };

  const handleAnimate = async () => {
    setAnimating(true);
    try {
      const res = await startAnimate(slug);
      setTaskId(res.task_id);
      navigate(`/stories/${slug}/pipeline`, { state: { taskId: res.task_id } });
    } catch (err) {
      console.error("Failed to start animation:", err);
      setAnimating(false);
    }
  };

  const handleTranslate = async () => {
    if (!translateLang.trim()) return;
    setTranslating(true);
    try {
      await startTranslate(slug, translateLang.trim());
      invalidate();
    } finally {
      setTranslating(false);
    }
  };

  const handleCastSave = async (cast: CastMember[]) => {
    setSavingCast(true);
    try {
      await updateStory(slug, { cast });
      invalidate();
      setShowCastEditor(false);
    } finally {
      setSavingCast(false);
    }
  };

  return (
    <div>
      {/* Actions bar */}
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-white rounded-[var(--radius-card)] border border-bark-100">
        <button
          onClick={handleIllustrate}
          className="px-4 py-2 text-xs font-semibold text-white bg-sage-600 hover:bg-sage-700 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
        >
          Generate Illustrations
        </button>
        {Object.keys(data.image_urls).length > 0 && (
          <button
            onClick={handleAnimate}
            disabled={animating}
            className="px-4 py-2 text-xs font-semibold text-white bg-sage-500 hover:bg-sage-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
            title={workerStatus?.available ? "GPU worker connected" : "GPU worker not connected"}
          >
            {animating ? "Starting..." : "Animate Pages"}
            {workerStatus && !workerStatus.available && (
              <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-rose-accent" />
            )}
            {workerStatus?.available && (
              <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-sage-300" />
            )}
          </button>
        )}
        {data.story.cast && data.story.cast.length > 0 && (
          <button
            onClick={() => setShowCastEditor(!showCastEditor)}
            className="px-4 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
          >
            {showCastEditor ? "Hide Cast" : `Edit Cast (${data.story.cast.length})`}
          </button>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={translateLang}
            onChange={(e) => setTranslateLang(e.target.value)}
            placeholder="Language..."
            className="px-3 py-2 text-xs bg-cream border border-bark-200 rounded-[var(--radius-btn)] w-28 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-400"
          />
          <button
            onClick={handleTranslate}
            disabled={translating || !translateLang.trim()}
            className="px-4 py-2 text-xs font-semibold text-bark-600 bg-bark-50 hover:bg-bark-100 disabled:opacity-40 rounded-[var(--radius-btn)] transition-colors"
          >
            {translating ? "Translating..." : "Translate"}
          </button>
        </div>
      </div>

      {/* Cast editor */}
      {showCastEditor && data.story.cast && (
        <div className="mb-6">
          <CastReviewPanel
            slug={slug}
            initialCast={data.story.cast}
            castRefUrls={data.cast_ref_urls ?? {}}
            mainRefSheetUrl={data.reference_sheet_url ?? null}
            onApprove={handleCastSave}
            approving={savingCast}
          />
        </div>
      )}

      {/* Keyframe grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {data.story.keyframes.map((kf) => (
          <KeyframeCard
            key={kf.page_number}
            keyframe={kf}
            imageUrl={data.image_urls[kf.page_number]}
            onClick={() => setSelectedPage(kf.page_number)}
          />
        ))}
      </div>

      <PageEditorDrawer
        keyframe={selectedKeyframe}
        imageUrl={selectedPage !== null ? data.image_urls[selectedPage] : undefined}
        open={selectedPage !== null}
        onClose={() => setSelectedPage(null)}
        onSave={handleSave}
        onRegenerate={handleRegenerate}
      />
    </div>
  );
}
