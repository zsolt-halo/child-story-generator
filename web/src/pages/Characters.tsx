import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAllCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  duplicateTemplate,
} from "../api/client";
import type { CharacterDetail, CharacterCreateRequest } from "../api/types";
import { CharacterEditor } from "../components/CharacterEditor";

export function Characters() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: characters, isLoading } = useQuery({
    queryKey: ["all-characters"],
    queryFn: listAllCharacters,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["all-characters"] });

  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      invalidate();
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
    },
  });

  const customizeMutation = useMutation({
    mutationFn: duplicateTemplate,
    onSuccess: (newChar) => {
      invalidate();
      if (newChar.id) {
        setEditingId(newChar.id);
      }
    },
  });

  const handleCreate = (data: CharacterCreateRequest) => {
    createMutation.mutate(data);
  };

  const handleUpdate = (id: string, data: CharacterCreateRequest) => {
    updateMutation.mutate({ id, data: data as unknown as Record<string, unknown> });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleCustomize = (slug: string) => {
    customizeMutation.mutate(slug);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-bark-800">Characters</h1>
          <p className="text-sm text-bark-400 mt-1">
            Manage character profiles for your stories
          </p>
        </div>
        <button
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-[var(--radius-btn)] transition-colors shadow-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Create New Character
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="mb-8 bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-bark-800 mb-4">
            New Character
          </h2>
          <CharacterEditor
            mode="create"
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 animate-pulse"
            >
              <div className="h-5 bg-bark-100 rounded w-2/3 mb-2" />
              <div className="h-3 bg-bark-100 rounded w-1/3 mb-4" />
              <div className="flex gap-1.5 mb-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div
                    key={j}
                    className="w-5 h-5 rounded-full bg-bark-100"
                  />
                ))}
              </div>
              <div className="flex gap-2 mb-3">
                <div className="h-5 bg-bark-100 rounded-full w-16" />
                <div className="h-5 bg-bark-100 rounded-full w-20" />
              </div>
              <div className="h-3 bg-bark-100 rounded w-full mb-1" />
              <div className="h-3 bg-bark-100 rounded w-4/5" />
            </div>
          ))}
        </div>
      ) : characters && characters.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {characters.map((char) => (
            <CharacterCard
              key={char.id ?? char.slug}
              character={char}
              isEditing={editingId === char.id}
              isConfirmingDelete={confirmDelete === char.id}
              onEdit={() => {
                setEditingId(char.id);
                setCreating(false);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={(data) => {
                if (char.id) handleUpdate(char.id, data);
              }}
              onCustomize={() => handleCustomize(char.slug)}
              isCustomizing={
                customizeMutation.isPending &&
                customizeMutation.variables === char.slug
              }
              onDeleteRequest={() => setConfirmDelete(char.id)}
              onDeleteConfirm={() => {
                if (char.id) handleDelete(char.id);
              }}
              onDeleteCancel={() => setConfirmDelete(null)}
              isDeleting={
                deleteMutation.isPending &&
                deleteMutation.variables === char.id
              }
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="w-20 h-20 mx-auto mb-4 bg-cream-dark rounded-full flex items-center justify-center">
            <svg
              className="w-10 h-10 text-bark-300"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-bark-600 mb-1">
            No characters yet
          </h2>
          <p className="text-sm text-bark-400 mb-6">
            Create your first character to use in stories
          </p>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-[var(--radius-btn)] transition-colors"
          >
            Create Your First Character
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Character Card ── */

interface CharacterCardProps {
  character: CharacterDetail;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: CharacterCreateRequest) => void;
  onCustomize: () => void;
  isCustomizing: boolean;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  isDeleting: boolean;
}

function CharacterCard({
  character,
  isEditing,
  isConfirmingDelete,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onCustomize,
  isCustomizing,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  isDeleting,
}: CharacterCardProps) {
  const palette = character.visual.color_palette.slice(0, 5);
  const traits = character.personality.traits.slice(0, 3);

  if (isEditing) {
    return (
      <div className="bg-white rounded-[var(--radius-card)] border border-amber-200 p-6 shadow-sm col-span-1 md:col-span-2 lg:col-span-3">
        <h2 className="text-lg font-bold text-bark-800 mb-4">
          Edit: {character.name}
        </h2>
        <CharacterEditor
          initialData={character}
          mode="edit"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm flex flex-col">
      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-bark-800 truncate">
            {character.name}
          </h3>
          <p className="text-xs text-bark-400 truncate">
            {character.child_name}
          </p>
        </div>
        {character.is_template && (
          <span className="shrink-0 ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sage-100 text-sage-700 rounded-full">
            Template
          </span>
        )}
      </div>

      {/* Color palette swatches */}
      {palette.length > 0 && (
        <div className="flex gap-1.5 mb-3">
          {palette.map((color) => (
            <div
              key={color}
              className="w-5 h-5 rounded-full border border-bark-200 shadow-sm"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      {/* Trait tags */}
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {traits.map((trait) => (
            <span
              key={trait}
              className="px-2 py-0.5 text-[11px] font-medium bg-bark-100 text-bark-600 rounded-full"
            >
              {trait}
            </span>
          ))}
          {character.personality.traits.length > 3 && (
            <span className="px-2 py-0.5 text-[11px] font-medium text-bark-400">
              +{character.personality.traits.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Visual description (truncated) */}
      {character.visual.description && (
        <p className="text-xs text-bark-500 line-clamp-2 mb-4 leading-relaxed">
          {character.visual.description}
        </p>
      )}

      {/* Spacer to push actions to bottom */}
      <div className="mt-auto" />

      {/* Delete confirmation */}
      {isConfirmingDelete ? (
        <div className="border-t border-bark-100 pt-3 mt-3">
          <p className="text-xs text-bark-600 font-medium mb-2">
            Are you sure you want to delete this character?
          </p>
          <div className="flex gap-2">
            <button
              onClick={onDeleteConfirm}
              disabled={isDeleting}
              className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors"
            >
              {isDeleting ? "Deleting..." : "Confirm Delete"}
            </button>
            <button
              onClick={onDeleteCancel}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Card actions */
        <div className="flex gap-2 border-t border-bark-100 pt-3 mt-3">
          {character.is_template ? (
            <button
              onClick={onCustomize}
              disabled={isCustomizing}
              className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors"
            >
              {isCustomizing ? "Duplicating..." : "Customize"}
            </button>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-[var(--radius-btn)] transition-colors"
              >
                Edit
              </button>
              <button
                onClick={onDeleteRequest}
                className="px-3 py-1.5 text-xs font-medium text-bark-500 bg-bark-50 hover:bg-red-50 hover:text-red-600 rounded-[var(--radius-btn)] transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
