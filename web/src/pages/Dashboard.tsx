import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { listStories, deleteStory, listPresets, listAllCharacters, startAutoGenerate, deletePreset, updatePreset } from "../api/client";
import { StoryCard } from "../components/StoryCard";
import { PresetCard } from "../components/PresetCard";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePipelineStore } from "../stores/pipelineStore";
import type { StoryListItem, PresetDetail } from "../api/types";

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [deleteTarget, setDeleteTarget] = useState<StoryListItem | null>(null);
  const [generatingPresetId, setGeneratingPresetId] = useState<string | null>(null);

  const { data: stories, isLoading } = useQuery({
    queryKey: ["stories"],
    queryFn: listStories,
  });

  const { data: presets } = useQuery({
    queryKey: ["presets"],
    queryFn: listPresets,
  });

  const { data: characters } = useQuery({
    queryKey: ["all-characters"],
    queryFn: listAllCharacters,
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => deleteStory(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stories"] });
      setDeleteTarget(null);
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (id: string) => deletePreset(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["presets"] }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (preset: PresetDetail) =>
      updatePreset(preset.id, { is_default: !preset.is_default }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["presets"] }),
  });

  const handleGenerateFromPreset = async (preset: PresetDetail) => {
    setGeneratingPresetId(preset.id);
    try {
      const res = await startAutoGenerate({
        character: preset.character,
        narrator: preset.narrator,
        style: preset.style,
        pages: preset.pages,
        language: preset.language || undefined,
        text_model: preset.text_model,
      });
      setTaskId(res.task_id);
      navigate("/stories/_/pipeline", { state: { taskId: res.task_id } });
    } catch (err) {
      console.error("Failed to start auto pipeline:", err);
      setGeneratingPresetId(null);
    }
  };

  const charNameMap = new Map(
    (characters || []).map((c) => [c.pipeline_id, c.name]),
  );

  const deleteDetails = deleteTarget
    ? [
        `${deleteTarget.page_count} pages`,
        ...(deleteTarget.has_images ? ["Illustrated"] : []),
        ...(deleteTarget.has_pdf ? ["Has PDF"] : []),
      ]
    : [];

  const hasPresets = presets && presets.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-bark-800">Your Stories</h1>
          <p className="text-sm text-bark-400 mt-1">Create and manage illustrated children's books</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/new?mode=auto"
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-sage-300 text-sage-700 hover:bg-sage-50 text-sm font-medium rounded-[var(--radius-btn)] transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            Surprise Me
          </Link>
          <Link
            to="/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-[var(--radius-btn)] transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Story
          </Link>
        </div>
      </div>

      {/* Preset strip */}
      {hasPresets && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-bark-400">Quick Generate</h2>
            <div className="flex-1 h-px bg-bark-100" />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                characterName={charNameMap.get(preset.character)}
                onGenerate={handleGenerateFromPreset}
                onSetDefault={(p) => setDefaultMutation.mutate(p)}
                onDelete={(p) => deletePresetMutation.mutate(p.id)}
                generating={generatingPresetId === preset.id}
              />
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[var(--radius-card)] border border-bark-100 overflow-hidden animate-pulse">
              <div className="aspect-square bg-bark-100" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-bark-100 rounded w-3/4" />
                <div className="h-3 bg-bark-100 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : stories && stories.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {stories.map((story) => (
            <StoryCard
              key={story.slug}
              story={story}
              onDelete={() => setDeleteTarget(story)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="w-20 h-20 mx-auto mb-4 bg-cream-dark rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-bark-600 mb-1">No stories yet</h2>
          <p className="text-sm text-bark-400 mb-6">Create your first illustrated children's book</p>
          <Link
            to="/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-[var(--radius-btn)] transition-colors"
          >
            Create Your First Story
          </Link>
        </div>
      )}

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.slug)}
        title="Delete Story"
        itemName={deleteTarget?.title ?? ""}
        details={deleteDetails}
        warning="This will permanently delete the story, all illustrations, and PDFs. This cannot be undone."
        isDeleting={deleteMutation.isPending}
        error={deleteMutation.error ? String(deleteMutation.error) : null}
      />
    </div>
  );
}
