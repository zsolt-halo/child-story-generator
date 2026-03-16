import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { updateStory, getWorkerStatus } from "../../api/client";
import { KeyframeCard } from "../KeyframeCard";
import { PageEditorDrawer } from "../PageEditorDrawer";
import { CastReviewPanel } from "../CastReviewPanel";
import { useStoryActions } from "../../hooks/useStoryActions";
import type { StoryDetail, CastMember } from "../../api/types";

interface PagesTabProps {
  slug: string;
  data: StoryDetail;
  invalidate: () => void;
}

export function PagesTab({ slug, data, invalidate }: PagesTabProps) {
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [showCastEditor, setShowCastEditor] = useState(false);
  const [savingCast, setSavingCast] = useState(false);
  const [translateLang, setTranslateLang] = useState("");
  const { handleAnimate, handleIllustrate, handleRegenerate, handleTranslate, animating, translating } = useStoryActions(slug, invalidate);

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
            onClick={() => handleTranslate(translateLang)}
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
