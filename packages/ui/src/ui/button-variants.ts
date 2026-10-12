import { cva } from "class-variance-authority";

// Zedative buttons (DESIGN.md § Components): body role, 4px radius, 36px
// default (32px `sm` for nav and toolbars), `0 12px 0 10px` padding around a
// leading 14px icon, an inset bottom lip that disappears on hover, and the
// `press` offset on :active. Only background, border colour and the lip
// transition. A trailing <Kbd> shortcut hint sits flush at the end.
// Every variant sets its own border colour (there is no base
// `border-transparent`), so the classes never conflict when
// `buttonVariants()` styles an <a> without going through `cn()`.
export const buttonVariants = cva(
  "group/button press type-body inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-clip-padding outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Solid cobalt with a darker 2px lip and a faint blue glint.
        default:
          "inset-shadow-lip-primary border-transparent bg-primary text-primary-foreground shadow-primary hover:inset-shadow-none hover:shadow-none aria-expanded:inset-shadow-none",
        // Zedative "secondary": paper at 60%, a 60% border, a grey lip.
        outline:
          "inset-shadow-lip border-border/60 bg-card/60 text-foreground hover:inset-shadow-none hover:bg-pane/70 aria-expanded:inset-shadow-none aria-expanded:bg-pane/70",
        // Neutral filled control (a pane chip); keeps the blue scarce.
        secondary:
          "inset-shadow-lip border-transparent bg-pane text-foreground hover:inset-shadow-none hover:bg-pane-2 aria-expanded:inset-shadow-none aria-expanded:bg-pane-2",
        // Nav links and toolbar icons: no fill until hover.
        ghost:
          "border-transparent text-foreground hover:bg-pane/70 aria-expanded:bg-pane/70 aria-[current=page]:bg-pane-2",
        destructive:
          "inset-shadow-lip border-destructive/25 bg-destructive/10 text-destructive hover:inset-shadow-none hover:bg-destructive/15 focus-visible:outline-destructive",
        // Text link: cobalt, underlined on hover, ends in a › chevron unless
        // it already carries an icon (inline-block keeps the underline off
        // the chevron).
        link: "border-transparent text-primary underline-offset-4 not-has-[svg]:after:ml-0.5 not-has-[svg]:after:inline-block not-has-[svg]:after:content-['›'] hover:underline",
      },
      size: {
        default:
          "h-9 px-3 has-[>[data-slot=kbd]]:pr-2 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "type-caption h-6 gap-1 rounded-sm px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-2.5 has-[>[data-slot=kbd]]:pr-1.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 px-4 has-[>[data-slot=kbd]]:pr-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        // Icon sizes match their text counterparts so an icon-only button
        // and a labelled one on the same toolbar row stay level.
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
