import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAllCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  duplicateTemplate,
  generateCharacterRefSheet,
  uploadCharacterPhoto,
} from "../api/client";
import type { CharacterDetail, SSEEvent } from "../api/types";
import { CharacterEditor } from "../components/CharacterEditor";
import { FamilyTreeSection } from "../components/FamilyTreeSection";
import { RefineRefSheetPanel } from "../components/RefineRefSheetPanel";
import { useSSE } from "../hooks/useSSE";

type PanelMode =
  | { kind: "empty" }
  | { kind: "view"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "create" };

export function Characters() {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<PanelMode>({ kind: "empty" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [autoGenTaskId, setAutoGenTaskId] = useState<string | null>(null);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);

  const { data: characters, isLoading } = useQuery({
    queryKey: ["all-characters"],
    queryFn: listAllCharacters,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["all-characters"] });

  const templates = characters?.filter((c) => c.is_template) ?? [];
  const custom = characters?.filter((c) => !c.is_template) ?? [];
  const hierarchy = buildSidebarHierarchy(custom);

  const selectedChar =
    panel.kind === "view" || panel.kind === "edit"
      ? characters?.find((c) => (c.id ?? c.slug) === panel.id)
      : null;

  const pendingPhotoRef = useRef<File | null>(null);

  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: async (newChar) => {
      let genTaskId: string | null = null;
      setPhotoUploadError(null);
      // If there's a pending photo from the "real" flow, upload it immediately
      if (pendingPhotoRef.current && newChar.id) {
        try {
          await uploadCharacterPhoto(newChar.id, pendingPhotoRef.current);
          // Photo uploaded — auto-trigger reference sheet generation
          try {
            const res = await generateCharacterRefSheet(newChar.id);
            genTaskId = res.task_id;
          } catch { /* generation failed to start, user can retry manually */ }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Photo upload failed";
          setPhotoUploadError(`Photo upload failed: ${msg}. You can upload it from the edit view.`);
          console.error("Photo upload failed for character", newChar.id, err);
        }
        pendingPhotoRef.current = null;
      }
      setAutoGenTaskId(genTaskId);
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
    setAutoGenTaskId(null);
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
                  hierarchy.map((entry) => (
                    <div key={entry.character.id ?? entry.character.slug}>
                      <SidebarItem
                        character={entry.character}
                        selected={
                          (panel.kind === "view" || panel.kind === "edit") &&
                          panel.id === (entry.character.id ?? entry.character.slug)
                        }
                        onClick={() => selectChar(entry.character)}
                      />
                      {entry.members.length > 0 && (
                        <div className="ml-6 mr-2 border-l border-bark-200">
                          {entry.members.map((m) => (
                            <NestedSidebarItem
                              key={m.character.id ?? m.character.slug}
                              character={m.character}
                              relationshipLabel={m.relationshipLabel}
                              selected={
                                (panel.kind === "view" || panel.kind === "edit") &&
                                panel.id === (m.character.id ?? m.character.slug)
                              }
                              onClick={() => selectChar(m.character)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
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
            <p className="text-sm text-bark-400 mb-6">Choose how you'd like to create your character</p>
            <CharacterEditor
              mode="create"
              onSave={(data, photo) => {
                if (photo) pendingPhotoRef.current = photo;
                createMutation.mutate(data);
              }}
              onCancel={() => setPanel({ kind: "empty" })}
              onPhotoChanged={invalidate}
            />
            {createMutation.isError && (
              <p className="text-xs text-red-600 mt-3">
                {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create"}
              </p>
            )}
          </div>
        )}

        {panel.kind === "view" && photoUploadError && (
          <div className="mx-6 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[var(--radius-card)] text-sm text-red-700 flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>{photoUploadError}</span>
            <button type="button" onClick={() => setPhotoUploadError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {panel.kind === "view" && selectedChar && (
          <DetailPanel
            key={selectedChar.id ?? selectedChar.slug}
            character={selectedChar}
            initialGenTaskId={autoGenTaskId}
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
            onRefSheetGenerated={invalidate}
            onNavigateToMember={(memberId) => {
              setConfirmDelete(false);
              setAutoGenTaskId(null);
              setPanel({ kind: "view", id: memberId });
            }}
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
              onPhotoChanged={invalidate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sidebar Hierarchy ── */

interface SidebarEntry {
  character: CharacterDetail;
  members: { character: CharacterDetail; relationshipLabel: string }[];
}

function buildSidebarHierarchy(characters: CharacterDetail[]): SidebarEntry[] {
  const byId = new Map<string, CharacterDetail>();
  for (const c of characters) {
    if (c.id) byId.set(c.id, c);
  }

  // Collect all member IDs that are nested under a protagonist
  const nestedIds = new Set<string>();
  // Characters that have family_members are "protagonists"
  const protagonistIds = new Set<string>();
  for (const c of characters) {
    if (c.family_members && c.family_members.length > 0 && c.id) {
      protagonistIds.add(c.id);
    }
  }

  // Figure out which members should be nested (not themselves protagonists)
  for (const c of characters) {
    if (!c.family_members) continue;
    for (const fm of c.family_members) {
      if (!protagonistIds.has(fm.member_id)) {
        nestedIds.add(fm.member_id);
      }
    }
  }

  const entries: SidebarEntry[] = [];
  for (const c of characters) {
    // Skip characters that are nested under someone else
    if (c.id && nestedIds.has(c.id)) continue;

    const members: SidebarEntry["members"] = [];
    if (c.family_members) {
      for (const fm of c.family_members) {
        // Only nest members that aren't themselves protagonists
        if (protagonistIds.has(fm.member_id)) continue;
        const memberChar = byId.get(fm.member_id);
        if (memberChar) {
          members.push({
            character: memberChar,
            relationshipLabel: fm.relationship_label,
          });
        }
      }
    }

    entries.push({ character: c, members });
  }

  return entries;
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
          ? "bg-sage-50 border-r-2 border-r-sage-500"
          : "hover:bg-bark-50"
      }`}
    >
      {character.reference_sheet_url ? (
        <img
          src={`${character.reference_sheet_url}?w=200`}
          alt={character.name}
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
      ) : (
        <PaletteAvatar palette={character.visual.color_palette} size={36} className="rounded-full" />
      )}
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
          {!character.is_template && character.family_member_count > 0 && (
            <span className="shrink-0 px-1.5 py-px text-[9px] font-bold bg-amber-100 text-amber-600 rounded">
              {character.family_member_count}
            </span>
          )}
        </div>
        <p className="text-[11px] text-bark-400 truncate">for {character.child_name}</p>
      </div>
    </button>
  );
}

/* ── Nested Sidebar Item (family member) ── */

function NestedSidebarItem({
  character,
  relationshipLabel,
  selected,
  onClick,
}: {
  character: CharacterDetail;
  relationshipLabel: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 pl-3 pr-3 py-2 text-left transition-colors ${
        selected
          ? "bg-sage-50 border-r-2 border-r-sage-500"
          : "hover:bg-bark-50"
      }`}
    >
      {character.reference_sheet_url ? (
        <img
          src={`${character.reference_sheet_url}?w=200`}
          alt={character.name}
          className="w-7 h-7 rounded-full object-cover shrink-0"
        />
      ) : (
        <PaletteAvatar palette={character.visual.color_palette} size={28} className="rounded-full" />
      )}
      <div className="min-w-0 flex-1">
        <span
          className={`text-xs font-medium truncate block ${
            selected ? "text-bark-800" : "text-bark-600"
          }`}
        >
          {character.name}
        </span>
        <p className="text-[10px] text-bark-400 truncate">{relationshipLabel}</p>
      </div>
    </button>
  );
}

/* ── Detail Panel (read-only view) ── */

function DetailPanel({
  character,
  initialGenTaskId,
  onEdit,
  onCustomize,
  isCustomizing,
  onDelete,
  confirmDelete,
  setConfirmDelete,
  isDeleting,
  deleteError,
  onRefSheetGenerated,
  onNavigateToMember,
}: {
  character: CharacterDetail;
  initialGenTaskId?: string | null;
  onEdit: () => void;
  onCustomize: () => void;
  isCustomizing: boolean;
  onDelete: () => void;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  isDeleting: boolean;
  deleteError: string | null;
  onRefSheetGenerated: () => void;
  onNavigateToMember?: (memberId: string) => void;
}) {
  const palette = character.visual.color_palette;
  const [generating, setGenerating] = useState(!!initialGenTaskId);
  const [genTaskId, setGenTaskId] = useState<string | null>(initialGenTaskId ?? null);
  const [genMessage, setGenMessage] = useState<string | null>(
    initialGenTaskId ? "Generating reference sheet..." : null
  );
  const [localRefUrl, setLocalRefUrl] = useState<string | null>(null);
  const [showRefine, setShowRefine] = useState(false);

  const identifier = character.is_template ? character.slug : character.id!;
  const refSheetUrl = localRefUrl ?? character.reference_sheet_url;

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if (event.type === "phase_start" && event.message) {
      setGenMessage(event.message);
    }
    if (event.type === "queue_position") {
      setGenMessage(`Waiting in queue (position ${event.position})...`);
    }
    if (event.type === "reference_sheet_complete") {
      setGenerating(false);
      setGenTaskId(null);
      setGenMessage(null);
      setLocalRefUrl(event.url ?? null);
      onRefSheetGenerated();
    }
    if (event.type === "task_complete") {
      setGenerating(false);
      setGenTaskId(null);
      setGenMessage(null);
    }
    if (event.type === "error") {
      setGenerating(false);
      setGenTaskId(null);
      setGenMessage(event.message ?? "Generation failed");
    }
  }, [onRefSheetGenerated]);

  useSSE(genTaskId, "/api/pipeline/progress", handleSSEEvent);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenMessage("Starting...");
    setLocalRefUrl(null);
    try {
      const res = await generateCharacterRefSheet(identifier);
      setGenTaskId(res.task_id);
    } catch {
      setGenerating(false);
      setGenMessage("Failed to start generation");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Uploaded reference photo */}
      {character.photo_url && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-amber-200 overflow-hidden bg-amber-50/30">
          <div className="flex items-center gap-4 p-4">
            <img
              src={`${character.photo_url}?w=200`}
              alt="Reference photo"
              className="w-20 h-20 rounded-lg object-cover border border-bark-200 shadow-sm"
            />
            <div>
              <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Reference Photo</span>
              <p className="text-xs text-bark-400 mt-0.5">
                Reference sheet will be generated to resemble this photo
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reference sheet hero */}
      {refSheetUrl ? (
        <div className="mb-6 rounded-[var(--radius-card)] border border-bark-100 overflow-hidden bg-white shadow-sm">
          <img
            src={`${refSheetUrl}?w=800`}
            alt={`${character.name} reference sheet`}
            className="w-full object-cover"
          />
          <div className="px-4 py-2.5 flex items-center justify-between border-t border-bark-100">
            <span className="text-[10px] font-semibold text-bark-400 uppercase tracking-wider">Reference Sheet</span>
            <div className="flex items-center gap-2">
              {/* Custom characters get the full Refine panel; templates get plain Regenerate */}
              {character.id && !character.is_template ? (
                <button
                  onClick={() => setShowRefine((v) => !v)}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
                  </svg>
                  {showRefine ? "Close" : "Refine"}
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="text-[11px] font-medium text-sage-600 hover:text-sage-700 disabled:opacity-50 transition-colors"
                >
                  {generating ? "Regenerating..." : "Regenerate"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-[var(--radius-card)] border border-dashed border-bark-200 bg-bark-50/50 p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-bark-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.068 2.068M12 6.75h.008v.008H12V6.75z" />
            </svg>
          </div>
          <p className="text-sm text-bark-500 mb-1">No visual preview yet</p>
          <p className="text-xs text-bark-400 mb-4">Generate a reference sheet to see how this character looks</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
          >
            {generating ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {genMessage || "Generating..."}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Generate Preview
              </>
            )}
          </button>
        </div>
      )}

      {/* Refine panel (photo-based characters) */}
      {showRefine && character.id && !character.is_template && (
        <div className="mb-6">
          <RefineRefSheetPanel
            character={character}
            currentRefSheetUrl={refSheetUrl}
            onAccepted={() => {
              setShowRefine(false);
              setLocalRefUrl(null);
              onRefSheetGenerated();
            }}
            onClose={() => setShowRefine(false)}
          />
        </div>
      )}

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
            {character.has_photo && (
              <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 rounded-full">
                Photo-based
              </span>
            )}
          </div>
          <p className="text-sm text-bark-400">
            for {character.child_name}{character.age ? ` \u00b7 ${character.age}` : ""}
          </p>

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

      {/* Family Tree (custom characters only) */}
      {!character.is_template && character.id && (
        <FamilyTreeSection
          characterId={character.id}
          characterName={character.name}
          onNavigateToMember={onNavigateToMember}
        />
      )}

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3">
        {character.is_template ? (
          <button
            onClick={onCustomize}
            disabled={isCustomizing}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors"
          >
            {isCustomizing ? "Duplicating..." : "Customize as New Character"}
          </button>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 rounded-[var(--radius-btn)] transition-colors"
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
