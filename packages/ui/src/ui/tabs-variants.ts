import { cva } from "class-variance-authority";

// Tabs, cursor.com's pricing toggle (Individual / Teams). `default` is a pill
// segmented control: a `pane` track with 4px of padding whose selected
// segment is a `card` pill with a hairline ring (cursor.com's dark toggle:
// #1b1913 on a #1f1d16 track). `line` sets the
// triggers on a 10% rule and marks the selected one with a 2px `foreground`
// underline. Weight stays 400 and nothing animates. Horizontal geometry is
// the default, so the variants also style plain links (`aria-current="page"`)
// outside a `Tabs` root; a vertical `Tabs` root flips them.
export const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit shrink-0 items-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  {
    variants: {
      variant: {
        default:
          "h-10 gap-0.5 rounded-full bg-pane p-1 group-data-vertical/tabs:rounded-lg",
        line: "h-9 gap-1 border-line border-b group-data-vertical/tabs:border-r group-data-vertical/tabs:border-b-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export const tabsTriggerVariants = cva(
  "type-body relative inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap border border-transparent px-4 text-muted-foreground outline-none transition-[background-color,border-color,box-shadow,color] duration-140 ease-standard hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[current=page]:text-foreground data-active:text-foreground group-data-vertical/tabs:h-8 group-data-vertical/tabs:w-full group-data-vertical/tabs:flex-none group-data-vertical/tabs:justify-start [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-full aria-[current=page]:bg-card aria-[current=page]:shadow-[0_0_0_1px_var(--hairline)] data-active:bg-card data-active:shadow-[0_0_0_1px_var(--hairline)] group-data-vertical/tabs:rounded-sm",
        // The underline overlaps the list's 1px rule.
        line: "px-3 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 aria-[current=page]:after:bg-foreground data-active:after:bg-foreground group-data-vertical/tabs:after:inset-x-auto group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-px group-data-vertical/tabs:after:h-auto group-data-vertical/tabs:after:w-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
