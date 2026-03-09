import { useState, useRef } from "react";

interface ComparisonSliderProps {
  beforeUrl: string;
  afterUrl: string;
}

export function ComparisonSlider({ beforeUrl, afterUrl }: ComparisonSliderProps) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPosition((x / rect.width) * 100);
  };

  return (
    <div
      ref={containerRef}
      className="relative aspect-square rounded-xl overflow-hidden cursor-col-resize select-none"
      onMouseMove={(e) => {
        if (e.buttons === 1) handleMove(e.clientX);
      }}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
    >
      {/* After (full) */}
      <img src={afterUrl} alt="After" className="absolute inset-0 w-full h-full object-cover" />

      {/* Before (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
      >
        <img
          src={beforeUrl}
          alt="Before"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ minWidth: containerRef.current?.offsetWidth }}
        />
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
        style={{ left: `${position}%` }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center">
          <svg className="w-4 h-4 text-bark-600" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
          </svg>
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-3 left-3 px-2 py-1 bg-bark-800/70 text-white text-[10px] font-semibold rounded backdrop-blur-sm">
        Before
      </span>
      <span className="absolute top-3 right-3 px-2 py-1 bg-sage-600/70 text-white text-[10px] font-semibold rounded backdrop-blur-sm">
        After
      </span>
    </div>
  );
}
