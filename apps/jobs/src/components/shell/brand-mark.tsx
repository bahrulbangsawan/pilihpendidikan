// The wordmark of the nav band (12 §2.1): the app mark (the favicon art,
// 20px with 4px corners) and "Pilih Jobs" on the subtitle scale, like
// cursor.com's header logotype.

const MARK_SIZE = 20;

export function BrandMark({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-foreground">
      <img
        alt=""
        aria-hidden="true"
        className="block size-5 shrink-0 rounded-sm"
        height={MARK_SIZE}
        src="/favicon/android-chrome-192x192.png"
        width={MARK_SIZE}
      />
      <span className="type-subtitle">{label}</span>
    </span>
  );
}
