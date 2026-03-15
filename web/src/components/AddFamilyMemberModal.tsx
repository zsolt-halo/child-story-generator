import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listAllCharacters, addFamilyMember, createAndLinkFamilyMember } from "../api/client";
import type { CharacterDetail, CharacterCreateRequest } from "../api/types";
import { CharacterEditor } from "./CharacterEditor";

const RELATIONSHIP_SUGGESTIONS = ["Mom", "Dad", "Sister", "Brother", "Grandma", "Grandpa", "Pet", "Best Friend", "Other"];

export function AddFamilyMemberModal({
  characterId,
  existingMemberIds,
  onClose,
  onAdded,
}: {
  characterId: string;
  existingMemberIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState<"pick" | "create">("pick");
  const [search, setSearch] = useState("");
  const [relationship, setRelationship] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const relationshipInputRef = useRef<HTMLInputElement>(null);

  const { data: characters, isSuccess } = useQuery({
    queryKey: ["all-characters"],
    queryFn: listAllCharacters,
  });

  // Auto-switch to "Create New" when no linkable characters exist
  const excludeIds = new Set([...existingMemberIds, characterId]);
  const available = (characters ?? []).filter(
    (c) => !c.is_template && c.id && !excludeIds.has(c.id),
  );

  useEffect(() => {
    if (isSuccess && available.length === 0) {
      setTab("create");
    }
  }, [isSuccess, available.length]);

  const addMutation = useMutation({
    mutationFn: ({ memberId, label }: { memberId: string; label: string }) =>
      addFamilyMember(characterId, { member_id: memberId, relationship_label: label }),
    onSuccess: onAdded,
  });

  const createAndLinkMutation = useMutation({
    mutationFn: ({ charData, label }: { charData: CharacterCreateRequest; label: string }) =>
      createAndLinkFamilyMember(characterId, { character: charData, relationship_label: label }),
    onSuccess: onAdded,
  });

  const filtered = search
    ? available.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : available;

  const handlePickExisting = () => {
    if (selectedMemberId && relationship.trim()) {
      addMutation.mutate({ memberId: selectedMemberId, label: relationship.trim() });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl border border-bark-100 w-full max-w-lg max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-bark-100 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-bark-800">Add Family Member</h2>
          <button onClick={onClose} className="text-bark-400 hover:text-bark-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-bark-100">
          <button
            onClick={() => setTab("pick")}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === "pick"
                ? "text-sage-700 border-b-2 border-sage-500"
                : "text-bark-400 hover:text-bark-600"
            }`}
          >
            Existing Character
          </button>
          <button
            onClick={() => setTab("create")}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === "create"
                ? "text-sage-700 border-b-2 border-sage-500"
                : "text-bark-400 hover:text-bark-600"
            }`}
          >
            Create New
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
          {/* Relationship field (shared between tabs) */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-bark-500 uppercase tracking-wide block mb-1.5">
              Relationship
            </label>
            <input
              ref={relationshipInputRef}
              type="text"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="e.g. Mom, Best Friend, Pet Cat, Uncle"
              className="w-full px-3 py-2 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-sage-400 focus:ring-1 focus:ring-sage-400"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {RELATIONSHIP_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    if (s === "Other") {
                      setRelationship("");
                      relationshipInputRef.current?.focus();
                    } else {
                      setRelationship(s);
                    }
                  }}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors ${
                    s !== "Other" && relationship === s
                      ? "bg-sage-500 text-white"
                      : "bg-bark-50 text-bark-500 hover:bg-bark-100"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {tab === "pick" && (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search characters..."
                className="w-full px-3 py-2 mb-3 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-sage-400 focus:ring-1 focus:ring-sage-400"
              />
              {filtered.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-bark-400">
                    {available.length === 0
                      ? "No other characters to link."
                      : "No matches found."}
                  </p>
                  {available.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setTab("create")}
                      className="mt-2 text-sm font-medium text-sage-600 hover:text-sage-700"
                    >
                      Create a new character &rarr;
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((c) => (
                    <CharacterPickRow
                      key={c.id}
                      character={c}
                      selected={selectedMemberId === c.id}
                      onSelect={() => setSelectedMemberId(c.id)}
                    />
                  ))}
                </div>
              )}

              {/* Add button */}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handlePickExisting}
                  disabled={!selectedMemberId || !relationship.trim() || addMutation.isPending}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-40 rounded-[var(--radius-btn)] transition-colors"
                >
                  {addMutation.isPending ? "Adding..." : "Add to Family"}
                </button>
              </div>
              {addMutation.isError && (
                <p className="text-xs text-red-600 mt-2">
                  {addMutation.error instanceof Error ? addMutation.error.message : "Failed to add"}
                </p>
              )}
            </>
          )}

          {tab === "create" && (
            <div className="mt-2">
              <CharacterEditor
                mode="create"
                onSave={(data: CharacterCreateRequest) => {
                  if (!relationship.trim()) return;
                  createAndLinkMutation.mutate({
                    charData: data,
                    label: relationship.trim(),
                  });
                }}
                onCancel={onClose}
              />
              {createAndLinkMutation.isError && (
                <p className="text-xs text-red-600 mt-2">
                  {createAndLinkMutation.error instanceof Error
                    ? createAndLinkMutation.error.message
                    : "Failed to create"}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CharacterPickRow({
  character,
  selected,
  onSelect,
}: {
  character: CharacterDetail;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        selected
          ? "bg-sage-50 border border-sage-300"
          : "hover:bg-bark-50 border border-transparent"
      }`}
    >
      {character.reference_sheet_url ? (
        <img
          src={`${character.reference_sheet_url}?w=200`}
          alt={character.name}
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
      ) : (
        <div
          className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
          style={{ backgroundColor: character.visual.color_palette[0] || "#b8a88a" }}
        >
          {character.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-bark-700 truncate block">{character.name}</span>
        <span className="text-[11px] text-bark-400">for {character.child_name}</span>
      </div>
      {selected && (
        <svg className="w-5 h-5 text-sage-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}
