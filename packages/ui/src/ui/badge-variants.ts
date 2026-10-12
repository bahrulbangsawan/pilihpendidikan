import { cva } from "class-variance-authority";

// Zedative tiny badge (DESIGN.md § Components / Shapes): a 2px chip in the
// micro role. `default` spends the cobalt, so prefer `secondary` or
// `outline` unless the badge is the one blue thing in view. Every variant sets
// its own border colour so `badgeVariants()` is conflict-free on an <a>.
export const badgeVariants = cva(
  "group/badge type-micro inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-1.5 outline-none transition-[background-color,border-color,color] duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-pane text-foreground [a]:hover:bg-pane-2",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive [a]:hover:bg-destructive/15",
        outline:
          "border-border bg-card/60 text-foreground [a]:hover:bg-pane/70",
        ghost:
          "border-transparent text-muted-foreground hover:bg-pane/70 hover:text-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
