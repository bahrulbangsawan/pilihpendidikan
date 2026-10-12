import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

// Zedative input group: the field shell (36px, 4px radius, a `line` outline
// on half-transparent paper) wrapping a borderless control and its addons.
// Focus and invalid ride on the control inside: the whole shell turns cobalt
// (or destructive) with the field halo.
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: <fieldset> carries default styling that conflicts with the inline composite input pattern
    <div
      className={cn(
        "group/input-group relative flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-card/60 outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard",
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20",
        "has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-destructive/15",
        "has-[[data-slot=input-group-control]:disabled]:bg-pane/50 has-[[data-slot=input-group-control]:disabled]:opacity-60",
        "in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-start]]:h-auto has-[>textarea]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:flex-col",
        "has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className
      )}
      data-slot="input-group"
      role="group"
      {...props}
    />
  );
}

// Addons sit 10px from the shell's edge, like the field's own text. A button
// or kbd pulls in so its gap to the edge matches its gap to the top.
const inputGroupAddonVariants = cva(
  "type-body flex h-auto cursor-text select-none items-center justify-center gap-1.5 py-1 text-muted-foreground group-data-[disabled=true]/input-group:opacity-50 [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-2.5 has-[>button]:-ml-1.25 has-[>kbd]:-ml-0.75",
        "inline-end":
          "order-last pr-2.5 has-[>button]:-mr-1.25 has-[>kbd]:-mr-0.75",
        "block-start":
          "order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:border-line [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:border-line [.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
);

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: click-to-focus label affordance — keyboard users tab to the input directly
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: group wrapper forwards click to its input child, not a true interactive target
    // biome-ignore lint/a11y/useSemanticElements: <fieldset> carries default styling that conflicts with the inline composite input pattern
    <div
      className={cn(inputGroupAddonVariants({ align }), className)}
      data-align={align}
      data-slot="input-group-addon"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      role="group"
      {...props}
    />
  );
}

// Buttons inside the shell are 2px chips (concentric with the 4px shell):
// 24px at `xs`, 28px at `sm`, leaving an even gap to the shell's edge.
const inputGroupButtonVariants = cva(
  "flex items-center gap-1.5 shadow-none focus-visible:outline-solid",
  {
    variants: {
      size: {
        xs: "type-caption h-6 gap-1 rounded-sm px-1.5 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-sm px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        "icon-xs": "size-6 rounded-sm p-0 has-[>svg]:p-0",
        "icon-sm": "size-7 rounded-sm p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
);

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      className={cn(inputGroupButtonVariants({ size }), className)}
      data-size={size}
      type={type}
      variant={variant}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "type-body flex items-center gap-2 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none",
        className
      )}
      data-slot="input-group-text"
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      className={cn(
        "h-auto flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 aria-invalid:ring-0",
        className
      )}
      data-slot="input-group-control"
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 aria-invalid:ring-0",
        className
      )}
      data-slot="input-group-control"
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
