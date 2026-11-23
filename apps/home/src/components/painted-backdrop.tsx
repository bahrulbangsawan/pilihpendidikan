// A painted landscape behind the hero window, made entirely in SVG: a hazy
// sky, a mountain range, two hills and a lake, roughened by a turbulence
// displacement (the brush edge) and finished with a canvas grain. Muted
// lavender-grey and ochre, like an impressionist study. Decorative only.

const SKY_TOP = "#aca7ad";
const SKY_HORIZON = "#c8bea8";
const RANGE_FAR = "#a39a97";
const RANGE_NEAR = "#8f837b";
const HILL_LEFT_LIGHT = "#b3a57c";
const HILL_LEFT_DARK = "#5e5a3e";
const HILL_RIGHT = "#9b857d";
const SHORE = "#5d5444";
const WATER_TOP = "#9b9bab";
const WATER_BOTTOM = "#7e8193";
const CLOUD = "#cfc8bb";
const GLINT = "#c2c1c8";

const CLOUDS = [
  { cx: 260, cy: 90, rx: 210, ry: 34 },
  { cx: 720, cy: 60, rx: 260, ry: 28 },
  { cx: 1110, cy: 120, rx: 220, ry: 36 },
  { cx: 520, cy: 170, rx: 170, ry: 22 },
] as const;

const GLINTS = [
  { x: 120, y: 560, w: 260 },
  { x: 460, y: 590, w: 340 },
  { x: 900, y: 570, w: 240 },
  { x: 200, y: 640, w: 420 },
  { x: 760, y: 660, w: 380 },
  { x: 1040, y: 620, w: 200 },
  { x: 60, y: 690, w: 300 },
] as const;

export function PaintedBackdrop() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1300 720"
    >
      <defs>
        <linearGradient id="pb-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="1" stopColor={SKY_HORIZON} />
        </linearGradient>
        <linearGradient id="pb-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={WATER_TOP} />
          <stop offset="1" stopColor={WATER_BOTTOM} />
        </linearGradient>
        <filter height="140%" id="pb-brush" width="140%" x="-20%" y="-20%">
          <feTurbulence
            baseFrequency="0.011 0.045"
            numOctaves="4"
            result="noise"
            seed="7"
            type="fractalNoise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="26" />
        </filter>
        <filter id="pb-soft">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="pb-grain">
          <feTurbulence
            baseFrequency="0.9"
            numOctaves="2"
            seed="3"
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix values="0 0 0 0 0.15  0 0 0 0 0.13  0 0 0 0 0.1  0 0 0 0.55 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="pb-mottle">
          <feTurbulence
            baseFrequency="0.016 0.034"
            numOctaves="3"
            seed="19"
            type="fractalNoise"
          />
          <feColorMatrix values="0.7 0 0 0 0.15  0 0.55 0 0 0.2  0 0 0.8 0 0.15  0 0 0 0 0.5" />
        </filter>
        <filter id="pb-strokes">
          <feTurbulence
            baseFrequency="0.004 0.09"
            numOctaves="3"
            seed="11"
            type="fractalNoise"
          />
          <feColorMatrix values="0 0 0 0 0.95  0 0 0 0 0.93  0 0 0 0 0.88  0 0 0 0.9 -0.35" />
        </filter>
      </defs>

      <rect fill="url(#pb-sky)" height="720" width="1300" />
      <g filter="url(#pb-soft)" opacity="0.8">
        {CLOUDS.map((cloud) => (
          <ellipse fill={CLOUD} key={cloud.cx} {...cloud} />
        ))}
      </g>

      <g filter="url(#pb-brush)">
        <path
          d="M-20 380 L90 250 L170 300 L260 210 L360 320 L470 280 L560 360 L700 330 L820 380 L-20 420 Z"
          fill={RANGE_FAR}
        />
        <path
          d="M700 380 L860 290 L960 330 L1060 250 L1180 310 L1320 270 L1320 420 L700 420 Z"
          fill={RANGE_NEAR}
        />
        <path
          d="M-20 330 C80 300 170 330 250 380 C330 430 380 470 420 520 L-20 540 Z"
          fill={HILL_LEFT_LIGHT}
        />
        <path
          d="M-20 430 C70 420 160 450 240 500 C290 530 320 560 340 600 L-20 620 Z"
          fill={HILL_LEFT_DARK}
        />
        <path
          d="M1320 300 C1240 320 1170 360 1120 420 C1090 460 1080 500 1090 540 L1320 560 Z"
          fill={HILL_RIGHT}
        />
        <path
          d="M300 520 C500 505 800 500 1100 515 L1100 528 C800 520 500 522 300 534 Z"
          fill={SHORE}
          opacity="0.6"
        />
        <rect fill="url(#pb-water)" height="200" width="1340" x="-20" y="530" />
        <g fill={GLINT} opacity="0.55">
          {GLINTS.map((glint) => (
            <rect
              height="5"
              key={`${glint.x}-${glint.y}`}
              rx="2.5"
              width={glint.w}
              x={glint.x}
              y={glint.y}
            />
          ))}
        </g>
      </g>

      <rect
        filter="url(#pb-mottle)"
        height="720"
        opacity="0.55"
        style={{ mixBlendMode: "overlay" }}
        width="1300"
      />
      <rect
        filter="url(#pb-strokes)"
        height="720"
        opacity="0.6"
        style={{ mixBlendMode: "soft-light" }}
        width="1300"
      />
      <rect
        filter="url(#pb-grain)"
        height="720"
        opacity="0.5"
        style={{ mixBlendMode: "multiply" }}
        width="1300"
      />
    </svg>
  );
}
