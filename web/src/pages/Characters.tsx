import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAllCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  duplicateTemplate,
} from "../api/client";
import type { CharacterDetail } from "../api/types";
import { CharacterEditor } from "../components/CharacterEditor";

type PanelMode =
  | { kind: "empty" }
  | { kind: "view"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "create" };

export function Characters() {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<PanelMode>({ kind: "empty" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: characters, isLoading } = useQuery({
    queryKey: ["all-characters"],
    queryFn: listAllCharacters,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["all-characters"] });

  const templates = characters?.filter((c) => c.is_template) ?? [];
  const custom = characters?.filter((c) => !c.is_template) ?? [];

  const selectedChar =
    panel.kind === "view" || panel.kind === "edit"
      ? characters?.find((c) => (c.id ?? c.slug) === panel.id)
      : null;

  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: (newChar) => {
      invalidate();
      setPanel({ kind: "view", id: newChar.id ?? newChar.slug });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      invalidate();
      if (panel.kind === "edit") setPanel({ kind: "view", id: panel.id });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      invalidate();
      setPanel({ kind: "empty" });
      setConfirmDelete(false);
    },
  });

  const customizeMutation = useMutation({
    mutationFn: duplicateTemplate,
    onSuccess: (newChar) => {
      invalidate();
      if (newChar.id) setPanel({ kind: "edit", id: newChar.id });
    },
  });

  const selectChar = (char: CharacterDetail) => {
    setConfirmDelete(false);
    setPanel({ kind: "view", id: char.id ?? char.slug });
  };

  return (
    <div className="-mx-6 -my-8 flex h-screen">
      {/* ── Left: Character sidebar ── */}
      <div className="w-72 shrink-0 border-r border-bark-200 bg-white flex flex-col">
        {/* Sidebar header */}
        <div className="px-4 py-5 border-b border-bark-100">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-extrabold text-bark-800">Characters</h1>
            <button
              onClick={() => {
                setConfirmDelete(false);
                setPanel({ kind: "create" });
              }}
              title="Create new character"
              className="w-7 h-7 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-bark-400">
            {characters ? `${templates.length} templates, ${custom.length} custom` : "Loading..."}
          </p>
        </div>

        {/* Sidebar list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-bark-100" />
                  <div className="flex-1">
                    <div className="h-3.5 bg-bark-100 rounded w-2/3 mb-1.5" />
                    <div className="h-2.5 bg-bark-100 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Templates section */}
              {templates.length > 0 && (
                <div>
                  <div className="px-4 pt-4 pb-1.5">
                    <span className="text-[10px] font-bold text-bark-400 uppercase tracking-widest">
                      Templates
                    </span>
                  </div>
                  {templates.map((char) => (
                    <SidebarItem
                      key={char.slug}
                      character={char}
                      selected={
                        (panel.kind === "view" || panel.kind === "edit") &&
                        panel.id === (char.id ?? char.slug)
                      }
                      onClick={() => selectChar(char)}
                    />
                  ))}
                </div>
              )}

              {/* Custom characters section */}
              <div>
                <div className="px-4 pt-4 pb-1.5">
                  <span className="text-[10px] font-bold text-bark-400 uppercase tracking-widest">
                    Your Characters
                  </span>
                </div>
                {custom.length > 0 ? (
                  custom.map((char) => (
                    <SidebarItem
                      key={char.id ?? char.slug}
                      character={char}
                      selected={
                        (panel.kind === "view" || panel.kind === "edit") &&
                        panel.id === (char.id ?? char.slug)
                      }
                      onClick={() => selectChar(char)}
                    />
                  ))
                ) : (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-bark-400 mb-3">No custom characters yet</p>
                    <button
                      onClick={() => setPanel({ kind: "create" })}
                      className="text-xs font-medium text-amber-600 hover:text-amber-700 underline underline-offset-2"
                    >
                      Create one
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Right: Detail / Editor panel ── */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-cream/50">
        {panel.kind === "empty" && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bark-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <p className="text-sm text-bark-400">Select a character to view details</p>
              <p className="text-xs text-bark-300 mt-1">or create a new one</p>
            </div>
          </div>
        )}

        {panel.kind === "create" && (
          <div className="max-w-2xl mx-auto px-6 py-8">
            <h2 className="text-xl font-extrabold text-bark-800 mb-1">New Character</h2>
            <p className="text-sm text-bark-400 mb-6">Define a new character for your stories</p>
            <CharacterEditor
              mode="create"
              onSave={(data) => createMutation.mutate(data)}
              onCancel={() => setPanel({ kind: "empty" })}
            />
            {createMutation.isError && (
              <p className="text-xs text-red-600 mt-3">
                {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create"}
              </p>
            )}
          </div>
        )}

        {panel.kind === "view" && selectedChar && (
          <DetailPanel
            character={selectedChar}
            onEdit={() => {
              if (selectedChar.id) setPanel({ kind: "edit", id: selectedChar.id });
            }}
            onCustomize={() => customizeMutation.mutate(selectedChar.slug)}
            isCustomizing={customizeMutation.isPending}
            onDelete={() => {
              if (selectedChar.id) deleteMutation.mutate(selectedChar.id);
            }}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            isDeleting={deleteMutation.isPending}
            deleteError={
              deleteMutation.isError
                ? deleteMutation.error instanceof Error
                  ? deleteMutation.error.message
                  : "Failed to delete"
                : null
            }
          />
        )}

        {panel.kind === "edit" && selectedChar && selectedChar.id && (
          <div className="max-w-2xl mx-auto px-6 py-8">
            <h2 className="text-xl font-extrabold text-bark-800 mb-1">
              Edit: {selectedChar.name}
            </h2>
            <p className="text-sm text-bark-400 mb-6">Update character details</p>
            <CharacterEditor
              initialData={selectedChar}
              mode="edit"
              onSave={(data) =>
                updateMutation.mutate({
                  id: selectedChar.id!,
                  data: data as unknown as Record<string, unknown>,
                })
              }
              onCancel={() => setPanel({ kind: "view", id: selectedChar.id! })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Palette Avatar ── */

function PaletteAvatar({
  palette,
  size = 36,
  className = "",
}: {
  palette: string[];
  size?: number;
  className?: string;
}) {
  const colors = palette.length > 0 ? palette.slice(0, 5) : ["#d4c5a9", "#b8a88a"];
  const ringCount = Math.min(colors.length, 5);
  const ringWidth = size / 2 / ringCount;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`shrink-0 ${className}`}
    >
      {colors
        .slice(0, ringCount)
        .reverse()
        .map((color, i) => {
          const outerIdx = ringCount - 1 - i;
          const r = (size / 2) - (outerIdx * ringWidth);
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={Math.max(r, 2)}
              fill={color}
            />
          );
        })}
    </svg>
  );
}

/* ── Sidebar Item ── */

function SidebarItem({
  character,
  selected,
  onClick,
}: {
  character: CharacterDetail;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        selected
          ? "bg-amber-50 border-r-2 border-r-amber-500"
          : "hover:bg-bark-50"
      }`}
    >
      <PaletteAvatar palette={character.visual.color_palette} size={36} className="rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-sm font-semibold truncate ${
              selected ? "text-bark-800" : "text-bark-700"
            }`}
          >
            {character.name}
          </span>
          {character.is_template && (
            <span className="shrink-0 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider bg-sage-100 text-sage-600 rounded">
              T
            </span>
          )}
        </div>
        <p className="text-[11px] text-bark-400 truncate">for {character.child_name}</p>
      </div>
    </button>
  );
}

/* ── Detail Panel (read-only view) ── */

function DetailPanel({
  character,
  onEdit,
  onCustomize,
  isCustomizing,
  onDelete,
  confirmDelete,
  setConfirmDelete,
  isDeleting,
  deleteError,
}: {
  character: CharacterDetail;
  onEdit: () => void;
  onCustomize: () => void;
  isCustomizing: boolean;
  onDelete: () => void;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  isDeleting: boolean;
  deleteError: string | null;
}) {
  const palette = character.visual.color_palette;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Hero header with avatar */}
      <div className="flex items-start gap-5 mb-8">
        <PaletteAvatar palette={palette} size={72} className="rounded-full shadow-md ring-2 ring-white" />
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-2xl font-extrabold text-bark-800 truncate">
              {character.name}
            </h2>
            {character.is_template && (
              <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-sage-100 text-sage-700 rounded-full">
                Template
              </span>
            )}
          </div>
          <p className="text-sm text-bark-400">for {character.child_name}</p>

          {/* Color palette swatches */}
          {palette.length > 0 && (
            <div className="flex gap-1.5 mt-3">
              {palette.map((color) => (
                <div
                  key={color}
                  className="w-5 h-5 rounded-full border border-bark-200/60 shadow-sm"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info sections */}
      <div className="space-y-5">
        {/* Personality */}
        <section className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5">
          <h3 className="text-xs font-bold text-bark-500 uppercase tracking-widest mb-3">
            Personality
          </h3>
          {character.personality.traits.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {character.personality.traits.map((trait) => (
                <span
                  key={trait}
                  className="px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full"
                >
                  {trait}
                </span>
              ))}
            </div>
          )}
          {character.personality.speech_style && (
            <div>
              <span className="text-[10px] font-semibold text-bark-400 uppercase tracking-wide">
                Speech Style
              </span>
              <p className="text-sm text-bark-600 mt-0.5 leading-relaxed">
                {character.personality.speech_style}
              </p>
            </div>
          )}
        </section>

        {/* Visual */}
        <section className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 space-y-3">
          <h3 className="text-xs font-bold text-bark-500 uppercase tracking-widest">
            Visual
          </h3>
          {character.visual.description && (
            <div>
              <span className="text-[10px] font-semibold text-bark-400 uppercase tracking-wide">
                Description
              </span>
              <p className="text-sm text-bark-600 mt-0.5 leading-relaxed">
                {character.visual.description}
              </p>
            </div>
          )}
          {character.visual.constants && (
            <div>
              <span className="text-[10px] font-semibold text-bark-400 uppercase tracking-wide">
                Constants
              </span>
              <p className="text-sm text-bark-600 mt-0.5 leading-relaxed">
                {character.visual.constants}
              </p>
            </div>
          )}
        </section>

        {/* Story Rules */}
        {(character.story_rules.always || character.story_rules.never) && (
          <section className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 space-y-3">
            <h3 className="text-xs font-bold text-bark-500 uppercase tracking-widest">
              Story Rules
            </h3>
            {character.story_rules.always && (
              <div>
                <span className="text-[10px] font-semibold text-sage-600 uppercase tracking-wide">
                  Always
                </span>
                <p className="text-sm text-bark-600 mt-0.5 leading-relaxed">
                  {character.story_rules.always}
                </p>
              </div>
            )}
            {character.story_rules.never && (
              <div>
                <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">
                  Never
                </span>
                <p className="text-sm text-bark-600 mt-0.5 leading-relaxed">
                  {character.story_rules.never}
                </p>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3">
        {character.is_template ? (
          <button
            onClick={onCustomize}
            disabled={isCustomizing}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors"
          >
            {isCustomizing ? "Duplicating..." : "Customize as New Character"}
          </button>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-[var(--radius-btn)] transition-colors"
            >
              Edit Character
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-4 py-2.5 text-sm font-medium text-bark-500 bg-bark-50 hover:bg-red-50 hover:text-red-600 rounded-[var(--radius-btn)] transition-colors"
              >
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-bark-500">Are you sure?</span>
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors"
                >
                  {isDeleting ? "Deleting..." : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-xs font-medium text-bark-600 bg-bark-100 hover:bg-bark-200 rounded-[var(--radius-btn)] transition-colors"
                >
                  No
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {deleteError && (
        <p className="text-xs text-red-600 mt-2">{deleteError}</p>
      )}

      {/* Pipeline ID info */}
      <div className="mt-6 pt-4 border-t border-bark-100">
        <span className="text-[10px] font-mono text-bark-300">
          pipeline_id: {character.pipeline_id}
        </span>
      </div>
    </div>
  );
}
