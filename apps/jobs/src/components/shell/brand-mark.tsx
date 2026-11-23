// The wordmark of the nav band (12 §2.1): a small solid mark and "Pilih
// Jobs" on the body scale, like cursor.com's header logotype. The mark is
// drawn in CSS, not an image.

export function BrandMark({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-foreground">
      <span
        aria-hidden="true"
        className="block size-4 shrink-0 rounded-xs bg-foreground"
      />
      <span className="type-subtitle">{label}</span>
    </span>
  );
}
