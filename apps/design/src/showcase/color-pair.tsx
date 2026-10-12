import { cn } from "@rulisme/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

// Resolves any CSS colour (hex, rgb, oklch, color-mix) to sRGB by painting
// one pixel. Translucent colours are composited over the backdrop, as the
// browser would.
function toRgb(color: string, backdrop = "#fff"): number[] | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.fillStyle = backdrop;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function toHex(rgb: number[]): string {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(rgb: number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.039_28
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[]): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort(
    (x, y) => y - x
  );
  return (light + 0.05) / (dark + 0.05);
}

const LEVELS = [
  { min: 7, label: "AAA" },
  { min: 4.5, label: "AA" },
  { min: 3, label: "AA large" },
] as const;

function wcagLevel(ratio: number): string {
  return LEVELS.find((level) => ratio >= level.min)?.label ?? "Fail";
}

/**
 * One palette swatch: the token painted as a chip, its DESIGN.md name, the
 * CSS variable and the value it resolves to in the current scheme.
 */
export function Swatch({ name, token }: { name: string; token: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const page = getComputedStyle(document.body).backgroundColor;
      const rgb = toRgb(getComputedStyle(element).backgroundColor, page);
      setHex(rgb ? toHex(rgb) : null);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className="h-12 border border-line"
        ref={ref}
        style={{ backgroundColor: `var(--${token})` }}
      />
      <div className="flex min-w-0 flex-col">
        <span className="type-caption weight-semibold truncate text-foreground">
          {name}
        </span>
        <span className="type-micro truncate text-muted-foreground">
          --{token}
        </span>
        <span className="type-micro text-muted-foreground tabular-nums">
          {hex ?? " "}
        </span>
      </div>
    </div>
  );
}

/**
 * A colour role: the surface with "Aa" in its foreground, the token names, the
 * resolved surface value and the contrast ratio measured live. It re-measures
 * when the theme class on <html> changes.
 */
export function ColorPair({
  name,
  background,
  foreground,
  className,
}: {
  name: string;
  background: string;
  foreground: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ ratio: number; bg: string } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const style = getComputedStyle(element);
      const page = getComputedStyle(document.body).backgroundColor;
      const bg = toRgb(style.backgroundColor, page);
      if (!bg) {
        return;
      }
      const fg = toRgb(style.color, toHex(bg));
      if (fg) {
        setInfo({ ratio: contrast(bg, fg), bg: toHex(bg) });
      }
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("flex min-w-0 flex-col border border-line", className)}>
      <div
        className="flex h-24 items-end justify-between p-4"
        ref={ref}
        style={{
          backgroundColor: `var(--${background})`,
          color: `var(--${foreground})`,
        }}
      >
        <span className="type-title">Aa</span>
        {info ? (
          <span className="type-micro rounded-sm border border-current/25 px-1.5 tabular-nums">
            {info.ratio.toFixed(2)} {wcagLevel(info.ratio)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 border-line border-t bg-card p-3">
        <span className="type-body weight-semibold text-foreground">
          {name}
        </span>
        <span className="type-caption text-muted-foreground">
          --{background} / --{foreground}
        </span>
        {info ? (
          <span className="type-caption text-muted-foreground tabular-nums">
            {info.bg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
