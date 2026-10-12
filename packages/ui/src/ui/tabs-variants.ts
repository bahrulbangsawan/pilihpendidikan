import { cva } from "class-variance-authority";

// Zedative tabs. `default` is a segmented control: a `pane` track whose
// selected segment sits on paper (bg-2) with the button lip. `line` sets the
// triggers on a hairline `line` rule and marks the selected one with a 2px
// `foreground` underline (never the cobalt). Selected triggers take the
// heading weight; nothing animates. Horizontal geometry is the default, so
// the variants also style plain links (`aria-current="page"`) outside a
// `Tabs` root; a vertical `Tabs` root flips them.
export const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit shrink-0 items-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  {
    variants: {
      variant: {
        default: "h-9 gap-0.5 rounded-md bg-pane p-0.5",
        line: "h-9 gap-1 border-line border-b group-data-vertical/tabs:border-r group-data-vertical/tabs:border-b-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export const tabsTriggerVariants = cva(
  "press type-body data-active:weight-semibold aria-[current=page]:weight-semibold relative inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap border border-transparent px-3 text-muted-foreground outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-standard hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[current=page]:text-foreground data-active:text-foreground group-data-vertical/tabs:h-8 group-data-vertical/tabs:w-full group-data-vertical/tabs:flex-none group-data-vertical/tabs:justify-start [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // 2px segments inside the 4px track keep the corners concentric.
        default:
          "rounded-sm aria-[current=page]:inset-shadow-lip aria-[current=page]:border-border/60 aria-[current=page]:bg-card data-active:inset-shadow-lip data-active:border-border/60 data-active:bg-card",
        // The underline overlaps the list's 1px rule.
        line: "rounded-md after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 aria-[current=page]:after:bg-foreground data-active:after:bg-foreground group-data-vertical/tabs:after:inset-x-auto group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-px group-data-vertical/tabs:after:h-auto group-data-vertical/tabs:after:w-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
