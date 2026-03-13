import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listAllCharacters, getStyles, getNarrators, startStoryOnly, startAutoGenerate, createCharacter, createPreset } from "../api/client";
import type { CharacterCreateRequest } from "../api/types";
import { StyleCard } from "../components/StyleCard";
import { LanguageSelect } from "../components/LanguageSelect";
import { CharacterEditor } from "../components/CharacterEditor";
import { usePipelineStore } from "../stores/pipelineStore";

const STEPS_MANUAL = ["Your Story", "Settings"];
const STEPS_AUTO = ["Settings"];

const SETTINGS_LS_KEY = "starlight-last-settings";

interface SavedSettings {
  character: string;
  style: string;
  narrator: string;
  pages: number;
  language: string;
  textModel: string;
}

function loadSettings(): Partial<SavedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings(s: SavedSettings) {
  try {
    localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

export function NewStory() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTaskId = usePipelineStore((s) => s.setTaskId);

  const saved = loadSettings();
  const [mode, setMode] = useState<"manual" | "auto">(
    searchParams.get("mode") === "auto" ? "auto" : "manual",
  );
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState("");
  const [character, setCharacter] = useState(saved.character ?? "");
  const [style, setStyle] = useState(saved.style ?? "digital");
  const [narrator, setNarrator] = useState(saved.narrator ?? "whimsical");
  const [pages, setPages] = useState(saved.pages ?? 16);
  const [language, setLanguage] = useState(saved.language ?? "");
  const [textModel, setTextModel] = useState<"gemini-2.5-pro" | "gemini-2.5-flash">(
    (saved.textModel as "gemini-2.5-pro" | "gemini-2.5-flash") ?? "gemini-2.5-pro",
  );
  const [submitting, setSubmitting] = useState(false);
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [settingsExpanded, setSettingsExpanded] = useState(!saved.character);

  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const queryClient = useQueryClient();

  const steps = mode === "auto" ? STEPS_AUTO : STEPS_MANUAL;

  // Reset step when toggling mode
  useEffect(() => {
    setStep(0);
  }, [mode]);

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

  // Auto-select first character if none saved
  if (characters && characters.length > 0 && !character) {
    setCharacter(characters[0].pipeline_id);
  }

  const currentStepLabel = steps[step];
  const isAuto = mode === "auto";

  const canProceed = () => {
    switch (currentStepLabel) {
      case "Your Story": return notes.trim().length > 10;
      case "Settings": return !!character && !!style && !!narrator;
      default: return false;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    // Persist settings for next time
    saveSettings({ character, style, narrator, pages, language, textModel });

    try {
      // Save preset if requested
      if (saveAsPreset && presetName.trim()) {
        await createPreset({
          name: presetName.trim(),
          character,
          narrator,
          style,
          pages,
          language: language || undefined,
          text_model: textModel,
          is_default: true,
        });
        queryClient.invalidateQueries({ queryKey: ["presets"] });
      }

      if (mode === "auto") {
        const res = await startAutoGenerate({
          character,
          narrator,
          style,
          pages,
          language: language || undefined,
          text_model: textModel,
        });
        setTaskId(res.task_id);
        navigate("/stories/_/pipeline", { state: { taskId: res.task_id } });
      } else {
        const res = await startStoryOnly({
          notes,
          character,
          narrator,
          style,
          pages,
          language: language || undefined,
          text_model: textModel,
        });
        setTaskId(res.task_id);
        navigate("/stories/_/pipeline", { state: { taskId: res.task_id } });
      }
    } catch (err) {
      console.error("Failed to start pipeline:", err);
      setSubmitting(false);
    }
  };

  // Resolve display names for settings summary
  const charName = characters?.find((c) => c.pipeline_id === character)?.name ?? character;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-extrabold text-bark-800 mb-2">Create a New Story</h1>
      <p className="text-sm text-bark-400 mb-6">
        {isAuto
          ? "Pick your settings and we\u2019ll dream up something delightful"
          : "Turn your daily notes into an illustrated children\u2019s book"}
      </p>

      {/* Mode toggle */}
      <div className="relative flex bg-bark-100 rounded-full p-1 mb-8">
        <div
          className="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out"
          style={{
            left: isAuto ? "50%" : "4px",
            right: isAuto ? "4px" : "50%",
            background: isAuto
              ? "linear-gradient(135deg, var(--color-sage-500), var(--color-sage-600))"
              : "white",
            boxShadow: isAuto
              ? "0 1px 4px rgba(90, 122, 90, 0.3)"
              : "0 1px 3px rgba(0,0,0,0.08)",
          }}
        />
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors duration-200 ${
            !isAuto ? "text-bark-800" : "text-bark-400 hover:text-bark-600"
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
          From My Notes
        </button>
        <button
          type="button"
          onClick={() => setMode("auto")}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors duration-200 ${
            isAuto ? "text-white" : "text-bark-400 hover:text-bark-600"
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          Surprise Me
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2 mb-8">
        {steps.map((label, i) => (
          <button
            key={label}
            onClick={() => i < step && setStep(i)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              i === step
                ? "bg-sage-100 text-sage-800"
                : i < step
                  ? "bg-sage-100 text-sage-700 cursor-pointer hover:bg-sage-200"
                  : "bg-bark-100 text-bark-400"
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i < step ? "bg-sage-500 text-white" : i === step ? "bg-sage-500 text-white" : "bg-bark-200 text-bark-500"
            }`}>
              {i < step ? "\u2713" : i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="space-y-4">
        {/* Step 1: "Your Story" (manual mode only) */}
        {currentStepLabel === "Your Story" && (
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
            <h2 className="font-bold text-bark-800 mb-1">What happened today?</h2>
            <p className="text-sm text-bark-400 mb-4">Write some notes about your child's day — we'll turn them into a story</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Today we went to the park and fed the ducks. Lana was very excited about the big white duck and wanted to share her sandwich..."
              rows={8}
              className="w-full px-4 py-3 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-sage-400 focus:ring-1 focus:ring-sage-400 resize-none leading-relaxed"
              style={{ fontFamily: "var(--font-story, Georgia, serif)" }}
              autoFocus
            />
            <div className="mt-2 text-xs text-bark-400 text-right">{notes.split(/\s+/).filter(Boolean).length} words</div>
          </div>
        )}

        {/* Step 2 / Settings (both modes) */}
        {currentStepLabel === "Settings" && (
          <>
            {/* Auto mode intro */}
            {isAuto && (
              <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-sage-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-sage-700">Fully automatic story</p>
                    <p className="text-xs text-sage-500 mt-0.5">
                      We'll dream up a story idea, write it, illustrate every page, and render the final book — all in one go.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Collapsible settings summary for returning users */}
            {!settingsExpanded && saved.character && (
              <button
                type="button"
                onClick={() => setSettingsExpanded(true)}
                className="w-full bg-white rounded-[var(--radius-card)] border border-bark-100 p-4 shadow-sm flex items-center justify-between hover:bg-bark-50/50 transition-colors text-left"
              >
                <div className="flex items-center gap-4 text-sm text-bark-600 overflow-hidden">
                  <span className="truncate"><span className="text-bark-400">Character:</span> {charName}</span>
                  <span className="text-bark-300">&middot;</span>
                  <span className="capitalize truncate"><span className="text-bark-400">Style:</span> {style}</span>
                  <span className="text-bark-300">&middot;</span>
                  <span className="truncate"><span className="text-bark-400">Pages:</span> {pages}</span>
                </div>
                <span className="text-xs text-sage-600 font-medium shrink-0 ml-3">Change</span>
              </button>
            )}

            {/* Full settings panel */}
            {(settingsExpanded || !saved.character) && (
              <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm space-y-6">
                {/* Character — horizontal scrollable strip */}
                <div>
                  <h3 className="text-xs font-semibold text-bark-500 uppercase tracking-wide mb-3">Character</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                    {characters?.map((c) => (
                      <button
                        key={c.pipeline_id}
                        type="button"
                        onClick={() => setCharacter(c.pipeline_id)}
                        className={`shrink-0 flex flex-col items-center gap-1.5 w-24 p-2.5 rounded-xl border-2 transition-all ${
                          character === c.pipeline_id
                            ? "border-sage-400 bg-sage-50 shadow-sm"
                            : "border-bark-100 hover:border-bark-200"
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                          character === c.pipeline_id ? "bg-sage-400 text-white" : "bg-bark-100 text-bark-400"
                        }`}>
                          {c.name[0]}
                        </div>
                        <span className="text-[11px] font-medium text-bark-700 truncate w-full text-center">{c.name}</span>
                        {c.is_template && (
                          <span className="text-[9px] text-bark-400 uppercase tracking-wider">Template</span>
                        )}
                      </button>
                    ))}
                    {/* Create new */}
                    <button
                      type="button"
                      onClick={() => setCreatingCharacter(true)}
                      className="shrink-0 flex flex-col items-center justify-center gap-1 w-24 p-2.5 rounded-xl border-2 border-dashed border-bark-200 hover:border-bark-300 hover:bg-bark-50 transition-colors"
                    >
                      <svg className="w-6 h-6 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      <span className="text-[10px] text-bark-400">New</span>
                    </button>
                  </div>

                  {/* Inline character editor */}
                  {creatingCharacter && (
                    <div className="mt-3 border border-bark-200 rounded-[var(--radius-card)] p-4 bg-cream/50">
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

                {/* Art style — 2x2 grid */}
                <div>
                  <h3 className="text-xs font-semibold text-bark-500 uppercase tracking-wide mb-3">Art Style</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {styles?.map((s) => (
                      <StyleCard
                        key={s.name}
                        style={s}
                        selected={style === s.name}
                        onClick={() => setStyle(s.name)}
                      />
                    ))}
                  </div>
                </div>

                {/* Narrator — pill buttons */}
                <div>
                  <h3 className="text-xs font-semibold text-bark-500 uppercase tracking-wide mb-3">Narrator Voice</h3>
                  <div className="flex flex-wrap gap-2">
                    {narrators?.map((n) => (
                      <button
                        key={n.slug}
                        onClick={() => setNarrator(n.slug)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                          narrator === n.slug
                            ? "bg-sage-500 text-white shadow-sm"
                            : "bg-bark-50 border border-bark-200 text-bark-600 hover:border-sage-300 hover:bg-sage-50"
                        }`}
                      >
                        {n.name}
                      </button>
                    ))}
                  </div>
                  {/* Example preview */}
                  {narrators && (() => {
                    const selected = narrators.find((n) => n.slug === narrator);
                    if (!selected) return null;
                    return (
                      <div
                        key={narrator}
                        className="mt-3 border-l-3 border-sage-400 bg-cream rounded-r-xl pl-4 pr-5 py-3 narrator-example-enter"
                      >
                        <p className="font-story italic text-bark-600 text-sm leading-relaxed">
                          &ldquo;{selected.example}&rdquo;
                        </p>
                        <p className="mt-1.5 text-[11px] text-bark-400">
                          <span className="font-semibold text-bark-500">{selected.name}</span>
                          {" \u2014 "}{selected.description}
                        </p>
                      </div>
                    );
                  })()}
                </div>

                {/* Pages + Language + Quality — compact row */}
                <div className="grid grid-cols-3 gap-4 items-start">
                  {/* Pages */}
                  <label className="block">
                    <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Pages</span>
                    <input
                      type="range"
                      min={8}
                      max={24}
                      step={2}
                      value={pages}
                      onChange={(e) => setPages(Number(e.target.value))}
                      className="mt-2 w-full accent-sage-500"
                    />
                    <div className="text-center text-xs font-semibold text-sage-700 mt-1">{pages}</div>
                  </label>

                  {/* Language */}
                  <div>
                    <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide block mb-2">Language</span>
                    <LanguageSelect value={language} onChange={setLanguage} compact />
                  </div>

                  {/* Quality */}
                  <div>
                    <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide block mb-2">Quality</span>
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTextModel("gemini-2.5-pro")}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          textModel === "gemini-2.5-pro"
                            ? "border-sage-400 bg-sage-50 text-sage-700"
                            : "border-bark-200 text-bark-500 hover:border-bark-300"
                        }`}
                      >
                        <svg className={`w-3 h-3 ${textModel === "gemini-2.5-pro" ? "text-sage-500" : "text-bark-400"}`} viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 1.5a.75.75 0 01.75.75V4.5a.75.75 0 01-1.5 0V2.25A.75.75 0 0112 1.5zM5.636 4.136a.75.75 0 011.06 0l1.592 1.591a.75.75 0 01-1.061 1.06l-1.591-1.59a.75.75 0 010-1.061zm12.728 0a.75.75 0 010 1.06l-1.591 1.592a.75.75 0 11-1.06-1.061l1.59-1.591a.75.75 0 011.061 0zm-6.816 4.496a.75.75 0 01.82.311l5.228 7.917a.75.75 0 01-.777 1.148l-2.097-.43 1.045 3.9a.75.75 0 01-1.45.388l-1.044-3.899-1.601 1.42a.75.75 0 01-1.247-.606l.569-9.47a.75.75 0 01.554-.679z" />
                        </svg>
                        Premium
                      </button>
                      <button
                        type="button"
                        onClick={() => setTextModel("gemini-2.5-flash")}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          textModel === "gemini-2.5-flash"
                            ? "border-sage-400 bg-sage-50 text-sage-700"
                            : "border-bark-200 text-bark-500 hover:border-bark-300"
                        }`}
                      >
                        <svg className={`w-3 h-3 ${textModel === "gemini-2.5-flash" ? "text-sage-500" : "text-bark-400"}`} viewBox="0 0 24 24" fill="currentColor">
                          <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clipRule="evenodd" />
                        </svg>
                        Express
                      </button>
                    </div>
                  </div>
                </div>

                {/* Save as preset (auto mode only) */}
                {isAuto && (
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={saveAsPreset}
                      onChange={(e) => setSaveAsPreset(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-bark-300 text-sage-500 focus:ring-sage-400"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-bark-700 group-hover:text-bark-800">
                        Save as preset for one-click generation
                      </span>
                      {saveAsPreset && (
                        <input
                          type="text"
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          placeholder="e.g. Lana's Bedtime Story"
                          className="mt-2 w-full px-3 py-2 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-sage-400 focus:ring-1 focus:ring-sage-400"
                          autoFocus
                        />
                      )}
                    </div>
                  </label>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => step > 0 ? setStep(step - 1) : navigate("/stories")}
          className="px-5 py-2.5 text-sm font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>

        {step < steps.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting || !canProceed()}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors active:scale-[0.97] flex items-center gap-2"
          >
            {submitting ? (
              "Starting..."
            ) : isAuto ? (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Generate Story
              </>
            ) : (
              "Create Story"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
