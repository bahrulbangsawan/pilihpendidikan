// The pilihpendidikan mark as a Zedative logo square (DESIGN.md § Components
// › Nav, § Shapes: 2px corners). The icon PNGs bake in round app-icon
// corners, so the image renders 40% larger than its square and the square
// crops those corners away; the glyph stays centred.
const SIZES = {
  sm: {
    box: "size-5",
    image: "-m-1 size-7",
    pixels: 28,
    src: "/favicon/favicon-32x32.png",
    srcSet: "/favicon/favicon-32x32.png 1x, /favicon/apple-touch-icon.png 2x",
  },
  lg: {
    box: "size-10",
    image: "-m-2 size-14",
    pixels: 56,
    src: "/favicon/apple-touch-icon.png",
    srcSet: undefined,
  },
} as const;

export function BrandMark({ size = "sm" }: { size?: keyof typeof SIZES }) {
  const mark = SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={`${mark.box} block shrink-0 overflow-hidden rounded-sm`}
    >
      <img
        alt=""
        className={`${mark.image} block max-w-none`}
        decoding="async"
        height={mark.pixels}
        src={mark.src}
        srcSet={mark.srcSet}
        width={mark.pixels}
      />
    </span>
  );
}
