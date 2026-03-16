import { useState, useEffect, useCallback } from "react";

/** Append ?w= to an image URL for server-side thumbnail resizing. */
export function thumb(url: string, width: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${width}`;
}

interface FadeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** If set, appends ?w= for server-side thumbnail. */
  thumbWidth?: number;
}

/**
 * Image component that fades in when loaded. Optionally requests a
 * server-side thumbnail via the `thumbWidth` prop.
 */
export function FadeImage({ src, thumbWidth, className = "", style, ...rest }: FadeImageProps) {
  const [loaded, setLoaded] = useState(false);

  const finalSrc = src && thumbWidth ? thumb(src, thumbWidth) : src;

  // Reset fade when the image source changes
  useEffect(() => { setLoaded(false); }, [finalSrc]);

  // Handle cached images: if the browser already has the image,
  // onLoad may fire before React attaches the handler. Use a ref
  // callback to catch img.complete on mount.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [finalSrc]);

  return (
    <img
      ref={imgRef}
      src={finalSrc}
      onLoad={() => setLoaded(true)}
      className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
      style={style}
      {...rest}
    />
  );
}
