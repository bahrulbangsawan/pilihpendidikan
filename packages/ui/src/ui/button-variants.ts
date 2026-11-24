import { cva } from "class-variance-authority";

// Cursor buttons, cursor.com's `.btn` family: pills with a 1px border,
// weight 400, leading 1, only colours transition (140ms). `default` is the
// dark pill, `secondary` the warm-grey pill, `outline` the 20%-outlined
// ghost, `ghost` a borderless toolbar control, `link` the orange text link
// with a trailing →. Sizes: `lg` 43px at 16px (Cursor's hero button),
// `default` 36px at 14px, `sm` 28px at 14px (Cursor's header buttons), `xs`
// 24px at 12px. `row` is the borderless full-width row target. A disabled primary
// (`default`) or destructive button keeps its colours at 50% opacity, so a
// form's one primary action ("Save changes") reads as primary even before
// anything changed; a disabled `secondary` turns into a flat card-03 pill
// like Cursor's; outline, ghost,
// row and link stay transparent with muted text. A ghost button fills while
// `aria-expanded` (an open menu); a bare disclosure chevron opts out with
// `aria-expanded:bg-transparent`.
// Every variant sets its own border colour (there is no base
// `border-transparent`), so the classes never conflict when
// `buttonVariants()` styles an <a> without going through `cn()`.
export const buttonVariants = cva(
  "group/button type-body inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border outline-none transition-[background-color,border-color,color] duration-140 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-[0.3ch] disabled:pointer-events-none aria-invalid:border-destructive [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:border-primary-deep hover:bg-primary-deep disabled:opacity-50 aria-expanded:border-primary-deep aria-expanded:bg-primary-deep",
        outline:
          "border-input bg-transparent text-foreground hover:bg-card active:bg-pane-2 disabled:border-border disabled:bg-transparent disabled:text-muted-foreground aria-expanded:bg-card",
        secondary:
          "border-hairline bg-secondary text-secondary-foreground hover:bg-pane-3 active:bg-secondary disabled:border-hairline disabled:bg-pane-2 disabled:text-muted-foreground aria-expanded:bg-pane-3",
        ghost:
          "border-transparent text-foreground hover:bg-pane disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground aria-expanded:bg-pane aria-[current=page]:bg-pane-2",
        destructive:
          "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:outline-destructive disabled:opacity-50",
        // A full-width click target (list rows, a collapsed lane, a sort
        // header): square-ish 4px corners, left-aligned, wrapping, `pane` on
        // hover and `pane-2` when current or pressed. Size only sets the gap.
        row: "h-auto! min-h-8 w-full justify-start whitespace-normal rounded-sm border-transparent px-2! py-1.5 text-left text-foreground hover:bg-pane disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground aria-expanded:bg-pane aria-pressed:bg-pane-2 aria-selected:bg-pane-2 aria-[current=page]:bg-pane-2",
        link: "h-auto! rounded-none border-transparent px-0! text-link not-has-[svg]:after:ml-1 not-has-[svg]:after:content-['→'] hover:text-link/75 disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground",
      },
      size: {
        default:
          "h-9 px-3.5 has-[>[data-slot=kbd]]:pr-2 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "type-caption h-6 gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 has-[>[data-slot=kbd]]:pr-1.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "type-subtitle h-[43px] px-[21.6px] has-[>[data-slot=kbd]]:pr-3 [&_svg:not([class*='size-'])]:size-4",
        // Icon sizes match their text counterparts so an icon-only button
        // and a labelled one on the same toolbar row stay level.
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-[43px] [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
