import { cva } from "class-variance-authority";

// Zedative badge, cursor.com's "Most popular" pill: a full-round chip in the
// caption role. `default` is the orange at 10% with orange text, `secondary`
// a card-03 pill, `outline` a 10% ring. Every variant sets
// its own border colour so `badgeVariants()` is conflict-free on an <a>.
export const badgeVariants = cva(
  "group/badge type-caption inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 outline-none transition-[background-color,border-color,color] duration-140 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-transparent bg-link/10 text-link [a]:hover:bg-link/15",
        secondary:
          "border-transparent bg-pane-2 text-foreground [a]:hover:bg-pane-3",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive [a]:hover:bg-destructive/15",
        outline:
          "border-border bg-transparent text-foreground [a]:hover:bg-card",
        ghost:
          "border-transparent text-muted-foreground hover:bg-pane hover:text-foreground",
        link: "border-transparent text-link hover:text-link/75",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
