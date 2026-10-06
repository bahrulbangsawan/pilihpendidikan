import { cn } from "../lib/utils";

// The nine cells of the Blocks spinner; animation and layout live in
// `.spinner-blocks` (@pilihpendidikan/config/motion.css).
const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const SIZE_CLASS = {
  // Inline, next to text or inside a control — matches the `size-3.5` icon rule.
  sm: "",
  // Standalone page or panel loader.
  md: "[--spinner-size:20px]",
} as const;

interface SpinnerProps {
  className?: string;
  /**
   * Forwarded as `data-icon` so a spinner swapped in for a button's leading or
   * trailing icon keeps the button's icon-side padding (no layout jump).
   */
  "data-icon"?: "inline-start" | "inline-end";
  /**
   * Announce the spinner as a polite status with this text. Omit it when
   * visible text beside the spinner already says what is loading.
   */
  label?: string;
  size?: keyof typeof SIZE_CLASS;
}

/** Blocks loading spinner (loading.dev). Decorative unless `label` is set. */
export function Spinner({
  className,
  "data-icon": dataIcon,
  label,
  size = "sm",
}: SpinnerProps) {
  const blocks = (
    <span
      aria-hidden="true"
      className={cn("spinner-blocks", SIZE_CLASS[size], className)}
      data-icon={dataIcon}
      data-slot="spinner"
    >
      {CELLS.map((cell) => (
        <span key={cell} />
      ))}
    </span>
  );
  if (!label) {
    return blocks;
  }
  return (
    <span className="inline-flex items-center" role="status">
      {blocks}
      <span className="sr-only">{label}</span>
    </span>
  );
}
