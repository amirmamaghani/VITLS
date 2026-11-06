import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";

// Fade the render's edges into the tile so its background never shows a seam.
const feather = {
  maskImage:
    "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent), linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent)",
  maskComposite: "intersect",
} as const;

/** Intrinsic size from the PNG header (IHDR), so the image box matches the render. */
function pngSize(path: string) {
  const head = readFileSync(path).subarray(16, 24);
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

/**
 * A slot for one Gemini clay render. Drop `public/images/<slot>.png` in and it
 * shows up; until then a soft clay blob holds the space (see README for prompts).
 */
export function ClayImage({
  slot,
  alt,
  className = "",
  sizes = "(min-width: 1024px) 50vw, 100vw",
  priority = false,
  feather: fade = true,
}: {
  slot: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Fade the edges into the tile; off for cut-out renders with a transparent background. */
  feather?: boolean;
}) {
  const file = `/images/${slot}.png`;
  const path = join(process.cwd(), "public", file);
  const size = existsSync(path) ? pngSize(path) : null;

  return (
    <div className={`relative ${className}`}>
      {size ? (
        // The box is the largest rectangle with the render's ratio that fits the slot.
        <div className="absolute inset-0 flex items-center justify-center [container-type:size]">
          <div
            className="relative max-h-full"
            style={{
              ...(fade ? feather : {}),
              aspectRatio: `${size.width} / ${size.height}`,
              width: `min(100cqw, ${(size.width / size.height).toFixed(4)} * 100cqh)`,
            }}
          >
            <Image
              src={file}
              alt={alt}
              fill
              sizes={sizes}
              priority={priority}
              className="object-contain"
            />
          </div>
        </div>
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="absolute inset-0 grid place-items-center"
        >
          <div className="aspect-square w-[min(62%,22rem)] rounded-full bg-[radial-gradient(circle_at_32%_28%,#ffffff_0%,rgba(255,255,255,0.4)_22%,transparent_48%),radial-gradient(circle_at_70%_78%,rgba(32,33,36,0.16),transparent_55%)] bg-white/40 shadow-[inset_-18px_-24px_48px_rgba(32,33,36,0.12),inset_14px_16px_32px_rgba(255,255,255,0.8),0_40px_60px_-30px_rgba(32,33,36,0.35)]" />
          {process.env.NODE_ENV === "development" && (
            <span className="absolute bottom-3 rounded-full bg-white/80 px-3 py-1 font-mono text-xs text-graphite">
              public{file}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
