import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStory, updateStory, startIllustrate, startIllustratePage, startTranslate } from "../api/client";
import { KeyframeCard } from "../components/KeyframeCard";
import { PageEditorDrawer } from "../components/PageEditorDrawer";
import { CastReviewPanel } from "../components/CastReviewPanel";
import { usePipelineStore } from "../stores/pipelineStore";
import type { CastMember } from "../api/types";

export function Storyboard() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [showCastEditor, setShowCastEditor] = useState(false);
  const [savingCast, setSavingCast] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateLang, setTranslateLang] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug!),
    enabled: !!slug,
  });

  const selectedKeyframe = data?.story.keyframes.find((kf) => kf.page_number === selectedPage) ?? null;

  const handleSave = useCallback(
    async (pageNumber: number, updates: { page_text?: string; visual_description?: string; mood?: string }) => {
      if (!slug) return;
      await updateStory(slug, {
        keyframes: { [pageNumber]: updates },
      });
      queryClient.invalidateQueries({ queryKey: ["story", slug] });
    },
    [slug, queryClient],
  );

  const handleRegenerate = useCallback(
    async (pageNumber: number) => {
      if (!slug) return;
      const res = await startIllustratePage(slug, pageNumber);
      setTaskId(res.task_id);
    },
    [slug, setTaskId],
  );

  const handleIllustrate = async () => {
    if (!slug) return;
    const res = await startIllustrate(slug);
    setTaskId(res.task_id);
  };

  const handleTranslate = async () => {
    if (!slug || !translateLang.trim()) return;
    setTranslating(true);
    try {
      await startTranslate(slug, translateLang.trim());
      queryClient.invalidateQueries({ queryKey: ["story", slug] });
    } finally {
      setTranslating(false);
    }
  };

  const handleCastSave = async (cast: CastMember[]) => {
    if (!slug) return;
    setSavingCast(true);
    try {
      await updateStory(slug, { cast });
      queryClient.invalidateQueries({ queryKey: ["story", slug] });
      setShowCastEditor(false);
    } finally {
      setSavingCast(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-bark-100 rounded w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square bg-bark-100 rounded-[var(--radius-card)]" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-bark-400">Story not found.</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-bark-800">{data.story.title}</h1>
          {data.story.title_translated && (
            <p className="text-sm text-bark-400 mt-0.5">{data.story.title_translated}</p>
          )}
          {data.story.dedication && (
            <p className="text-sm text-bark-500 mt-1 italic font-[family-name:var(--font-story)]">
              {data.story.dedication}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {data.has_pdf && (
            <Link
              to={`/stories/${slug}/book`}
              className="px-4 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
            >
              View Book
            </Link>
          )}
          {Object.keys(data.image_urls).length > 0 && (
            <Link
              to={`/stories/${slug}/review`}
              className="px-4 py-2 text-xs font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-[var(--radius-btn)] transition-colors"
            >
              Review Illustrations
            </Link>
          )}
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-white rounded-[var(--radius-card)] border border-bark-100">
        <button
          onClick={handleIllustrate}
          className="px-4 py-2 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-[var(--radius-btn)] transition-colors"
        >
          Generate Illustrations
        </button>
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
            className="px-3 py-2 text-xs bg-cream border border-bark-200 rounded-[var(--radius-btn)] w-28 focus:outline-none focus:border-amber-400"
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
      {showCastEditor && data.story.cast && slug && (
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

      {/* Page editor drawer */}
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
