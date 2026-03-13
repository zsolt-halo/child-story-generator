import { useState, useRef, useEffect, useMemo } from "react";

interface Language {
  code: string;
  flag: string;
  name: string;
  value: string; // what gets stored in state (lowercase name)
}

const LANGUAGES: Language[] = [
  { code: "HU", flag: "\u{1F1ED}\u{1F1FA}", name: "Hungarian", value: "hungarian" },
  { code: "DE", flag: "\u{1F1E9}\u{1F1EA}", name: "German", value: "german" },
  { code: "FR", flag: "\u{1F1EB}\u{1F1F7}", name: "French", value: "french" },
  { code: "ES", flag: "\u{1F1EA}\u{1F1F8}", name: "Spanish", value: "spanish" },
  { code: "IT", flag: "\u{1F1EE}\u{1F1F9}", name: "Italian", value: "italian" },
  { code: "PT", flag: "\u{1F1F5}\u{1F1F9}", name: "Portuguese", value: "portuguese" },
  { code: "NL", flag: "\u{1F1F3}\u{1F1F1}", name: "Dutch", value: "dutch" },
  { code: "PL", flag: "\u{1F1F5}\u{1F1F1}", name: "Polish", value: "polish" },
  { code: "CZ", flag: "\u{1F1E8}\u{1F1FF}", name: "Czech", value: "czech" },
  { code: "SK", flag: "\u{1F1F8}\u{1F1F0}", name: "Slovak", value: "slovak" },
  { code: "RO", flag: "\u{1F1F7}\u{1F1F4}", name: "Romanian", value: "romanian" },
  { code: "HR", flag: "\u{1F1ED}\u{1F1F7}", name: "Croatian", value: "croatian" },
  { code: "SE", flag: "\u{1F1F8}\u{1F1EA}", name: "Swedish", value: "swedish" },
  { code: "NO", flag: "\u{1F1F3}\u{1F1F4}", name: "Norwegian", value: "norwegian" },
  { code: "DK", flag: "\u{1F1E9}\u{1F1F0}", name: "Danish", value: "danish" },
  { code: "FI", flag: "\u{1F1EB}\u{1F1EE}", name: "Finnish", value: "finnish" },
  { code: "JP", flag: "\u{1F1EF}\u{1F1F5}", name: "Japanese", value: "japanese" },
  { code: "KR", flag: "\u{1F1F0}\u{1F1F7}", name: "Korean", value: "korean" },
  { code: "CN", flag: "\u{1F1E8}\u{1F1F3}", name: "Chinese", value: "chinese" },
  { code: "RU", flag: "\u{1F1F7}\u{1F1FA}", name: "Russian", value: "russian" },
  { code: "TR", flag: "\u{1F1F9}\u{1F1F7}", name: "Turkish", value: "turkish" },
  { code: "GR", flag: "\u{1F1EC}\u{1F1F7}", name: "Greek", value: "greek" },
  { code: "UA", flag: "\u{1F1FA}\u{1F1E6}", name: "Ukrainian", value: "ukrainian" },
  { code: "AR", flag: "\u{1F1F8}\u{1F1E6}", name: "Arabic", value: "arabic" },
  { code: "IN", flag: "\u{1F1EE}\u{1F1F3}", name: "Hindi", value: "hindi" },
  { code: "TH", flag: "\u{1F1F9}\u{1F1ED}", name: "Thai", value: "thai" },
  { code: "VN", flag: "\u{1F1FB}\u{1F1F3}", name: "Vietnamese", value: "vietnamese" },
  { code: "IL", flag: "\u{1F1EE}\u{1F1F1}", name: "Hebrew", value: "hebrew" },
  { code: "BG", flag: "\u{1F1E7}\u{1F1EC}", name: "Bulgarian", value: "bulgarian" },
  { code: "RS", flag: "\u{1F1F7}\u{1F1F8}", name: "Serbian", value: "serbian" },
];

interface LanguageSelectProps {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}

export function LanguageSelect({ value, onChange, compact }: LanguageSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = LANGUAGES.find((l) => l.value === value) ?? null;

  const filtered = useMemo(() => {
    if (!query) return LANGUAGES;
    const q = query.toLowerCase();
    return LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        l.value.includes(q),
    );
  }, [query]);

  // Reset highlight when filter changes
  useEffect(() => { setHighlightIndex(0); }, [filtered.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (lang: Language) => {
    onChange(lang.value);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const handleClear = () => {
    onChange("");
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightIndex]) handleSelect(filtered[highlightIndex]);
        break;
      case "Escape":
        setOpen(false);
        setQuery("");
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {!compact && (
        <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">
          Translation Language (optional)
        </span>
      )}

      <div className={`relative ${compact ? "" : "mt-1.5"}`}>
        {/* Selected chip shown when not editing */}
        {selected && !open ? (
          <button
            type="button"
            onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-left text-sm text-bark-800 hover:border-amber-300 transition-colors"
          >
            <span className="text-lg leading-none">{selected.flag}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-bark-100 text-bark-500 tracking-wider">
              {selected.code}
            </span>
            <span className="flex-1">{selected.name}</span>
            <span
              onClick={(e) => { e.stopPropagation(); handleClear(); }}
              className="text-bark-300 hover:text-bark-500 transition-colors p-0.5 -mr-1"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
            </span>
          </button>
        ) : (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search language..."
              className="w-full pl-9 pr-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-colors"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
        )}

        {/* Dropdown */}
        {open && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-bark-200 rounded-xl shadow-lg lang-dropdown-enter"
          >
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-bark-400 text-center">No languages found</div>
            ) : (
              filtered.map((lang, i) => (
                <button
                  key={lang.code}
                  type="button"
                  onMouseEnter={() => setHighlightIndex(i)}
                  onClick={() => handleSelect(lang)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    i === highlightIndex
                      ? "bg-amber-50 text-bark-800"
                      : "text-bark-600 hover:bg-bark-50"
                  } ${lang.value === value ? "font-medium" : ""}`}
                >
                  <span className="text-base leading-none">{lang.flag}</span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-bark-100 text-bark-500 tracking-wider min-w-[28px] justify-center">
                    {lang.code}
                  </span>
                  <span className="flex-1">{lang.name}</span>
                  {lang.value === value && (
                    <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
