// The wordmark of the nav band (12 §2.1): "◆ Pilih Jobs". The mark is the
// Zedative diamond node (a 45° square on the rule), not an image.

export function BrandMark({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-foreground">
      <span
        aria-hidden="true"
        className="block size-2.5 shrink-0 rotate-45 border border-foreground bg-foreground"
      />
      <span className="type-title-compact">{label}</span>
    </span>
  );
}
