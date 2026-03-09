import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listAllCharacters, getStyles, getNarrators, startStoryOnly, createCharacter, duplicateTemplate } from "../api/client";
import type { CharacterCreateRequest } from "../api/types";
import { PickerCard } from "../components/PickerCard";
import { CharacterEditor } from "../components/CharacterEditor";
import { usePipelineStore } from "../stores/pipelineStore";

const STEPS = ["Notes", "Character", "Style & Narrator", "Settings"];

const STYLE_ICONS: Record<string, string> = {
  digital: "🎨",
  watercolor: "🖌️",
  ghibli: "🏯",
  papercut: "✂️",
};

const NARRATOR_ICONS: Record<string, string> = {
  whimsical: "🎪",
  bedtime: "🌙",
  heroic: "⚔️",
};

export function NewStory() {
  const navigate = useNavigate();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState("");
  const [character, setCharacter] = useState("");
  const [style, setStyle] = useState("digital");
  const [narrator, setNarrator] = useState("whimsical");
  const [pages, setPages] = useState(16);
  const [language, setLanguage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const queryClient = useQueryClient();

  const { data: characters } = useQuery({ queryKey: ["all-characters"], queryFn: listAllCharacters });
  const { data: styles } = useQuery({ queryKey: ["styles"], queryFn: getStyles });
  const { data: narrators } = useQuery({ queryKey: ["narrators"], queryFn: getNarrators });

  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: (newChar) => {
      queryClient.invalidateQueries({ queryKey: ["all-characters"] });
      setCharacter(newChar.pipeline_id);
      setCreatingCharacter(false);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: duplicateTemplate,
    onSuccess: (newChar) => {
      queryClient.invalidateQueries({ queryKey: ["all-characters"] });
      setCharacter(newChar.pipeline_id);
    },
  });

  // Auto-select first character
  if (characters && characters.length > 0 && !character) {
    setCharacter(characters[0].pipeline_id);
  }

  const canProceed = () => {
    switch (step) {
      case 0: return notes.trim().length > 10;
      case 1: return !!character;
      case 2: return !!style && !!narrator;
      case 3: return true;
      default: return false;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await startStoryOnly({
        notes,
        character,
        narrator,
        style,
        pages,
        language: language || undefined,
      });
      setTaskId(res.task_id);
      // Navigate to pipeline — slug will come from SSE events
      navigate("/stories/_/pipeline", { state: { taskId: res.task_id } });
    } catch (err) {
      console.error("Failed to start pipeline:", err);
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-extrabold text-bark-800 mb-2">Create a New Story</h1>
      <p className="text-sm text-bark-400 mb-8">Turn your daily notes into an illustrated children's book</p>

      {/* Step indicators */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => i < step && setStep(i)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              i === step
                ? "bg-amber-100 text-amber-800"
                : i < step
                  ? "bg-sage-100 text-sage-700 cursor-pointer hover:bg-sage-200"
                  : "bg-bark-100 text-bark-400"
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i < step ? "bg-sage-500 text-white" : i === step ? "bg-amber-500 text-white" : "bg-bark-200 text-bark-500"
            }`}>
              {i < step ? "✓" : i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
        {step === 0 && (
          <div>
            <h2 className="font-bold text-bark-800 mb-1">Write Your Notes</h2>
            <p className="text-sm text-bark-400 mb-4">Describe what happened today — the story will be generated from these notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Today we went to the park and fed the ducks. Lana was very excited about the big white duck and wanted to share her sandwich..."
              rows={8}
              className="w-full px-4 py-3 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 resize-none"
              autoFocus
            />
            <div className="mt-2 text-xs text-bark-400 text-right">{notes.split(/\s+/).filter(Boolean).length} words</div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="font-bold text-bark-800 mb-1">Choose a Character</h2>
            <p className="text-sm text-bark-400 mb-4">Pick the protagonist for this story</p>
            <div className="grid grid-cols-1 gap-3">
              {characters?.map((c) => (
                <div key={c.pipeline_id} className="relative">
                  <PickerCard
                    selected={character === c.pipeline_id}
                    onClick={() => setCharacter(c.pipeline_id)}
                    title={c.name}
                    subtitle={`for ${c.child_name}`}
                    description={c.visual.description}
                    icon={
                      c.is_template ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bark-100 text-bark-500 uppercase tracking-wide">
                          Template
                        </span>
                      ) : undefined
                    }
                  />
                  {/* Personality traits */}
                  {c.personality.traits.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 ml-1">
                      {c.personality.traits.slice(0, 5).map((trait) => (
                        <span
                          key={trait}
                          className="inline-block px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-medium rounded-full"
                        >
                          {trait}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Customize button for templates */}
                  {c.is_template && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateMutation.mutate(c.slug);
                      }}
                      disabled={duplicateMutation.isPending}
                      className="absolute top-3 right-3 text-[11px] font-medium text-amber-600 hover:text-amber-800 underline underline-offset-2 transition-colors"
                    >
                      {duplicateMutation.isPending ? "Customizing..." : "Customize"}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Create Custom Character */}
            {!creatingCharacter ? (
              <button
                type="button"
                onClick={() => setCreatingCharacter(true)}
                className="mt-4 w-full px-4 py-3 text-sm font-medium text-bark-500 bg-bark-50 hover:bg-bark-100 border border-dashed border-bark-300 rounded-[var(--radius-card)] transition-colors"
              >
                + Create Custom Character
              </button>
            ) : (
              <div className="mt-4 border border-bark-200 rounded-[var(--radius-card)] p-4 bg-cream/50">
                <h3 className="text-sm font-bold text-bark-700 mb-4">New Character</h3>
                <CharacterEditor
                  mode="create"
                  onSave={(data: CharacterCreateRequest) => createMutation.mutate(data)}
                  onCancel={() => setCreatingCharacter(false)}
                />
                {createMutation.isError && (
                  <p className="text-xs text-red-600 mt-2">
                    {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create character"}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-bold text-bark-800 mb-1">Art Style</h2>
              <p className="text-sm text-bark-400 mb-4">Choose the illustration style</p>
              <div className="grid grid-cols-2 gap-3">
                {styles?.map((s) => (
                  <PickerCard
                    key={s.name}
                    selected={style === s.name}
                    onClick={() => setStyle(s.name)}
                    title={s.name.charAt(0).toUpperCase() + s.name.slice(1)}
                    description={s.description}
                    icon={<span>{STYLE_ICONS[s.name] || "🎨"}</span>}
                  />
                ))}
              </div>
            </div>

            <div>
              <h2 className="font-bold text-bark-800 mb-1">Narrator Voice</h2>
              <p className="text-sm text-bark-400 mb-4">Choose the storytelling tone</p>
              <div className="grid grid-cols-1 gap-3">
                {narrators?.map((n) => (
                  <PickerCard
                    key={n.slug}
                    selected={narrator === n.slug}
                    onClick={() => setNarrator(n.slug)}
                    title={n.name}
                    description={n.example}
                    icon={<span>{NARRATOR_ICONS[n.slug] || "📖"}</span>}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-bold text-bark-800 mb-1">Settings</h2>
              <p className="text-sm text-bark-400 mb-4">Final configuration</p>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Number of Pages</span>
              <input
                type="range"
                min={8}
                max={24}
                step={2}
                value={pages}
                onChange={(e) => setPages(Number(e.target.value))}
                className="mt-2 w-full accent-amber-500"
              />
              <div className="flex justify-between text-xs text-bark-400 mt-1">
                <span>8</span>
                <span className="font-semibold text-amber-700">{pages} pages</span>
                <span>24</span>
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Translation Language (optional)</span>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g., hungarian, german, french"
                className="mt-1.5 w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
            </label>

            {/* Summary */}
            <div className="bg-cream rounded-xl p-4 space-y-2 text-sm">
              <h3 className="font-semibold text-bark-700">Summary</h3>
              <div className="grid grid-cols-2 gap-2 text-bark-600">
                <span className="text-bark-400">Character:</span>
                <span>{characters?.find((c) => c.pipeline_id === character)?.name ?? character}</span>
                <span className="text-bark-400">Style:</span>
                <span className="capitalize">{style}</span>
                <span className="text-bark-400">Narrator:</span>
                <span className="capitalize">{narrator}</span>
                <span className="text-bark-400">Pages:</span>
                <span>{pages}</span>
                {language && (
                  <>
                    <span className="text-bark-400">Language:</span>
                    <span className="capitalize">{language}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="px-5 py-2.5 text-sm font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
        >
          Back
        </button>

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
          >
            {submitting ? "Starting..." : "Create Story"}
          </button>
        )}
      </div>
    </div>
  );
}
