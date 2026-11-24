import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      className={cn("scroll-my-1", className)}
      data-slot="select-group"
      {...props}
    />
  );
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

// The trigger is the cursor.com field (36px, 32px at `sm`, 8px radius, a 10%
// border on the page colour that deepens to 20% on hover and focus) with a
// muted chevron, so it lines up with the inputs beside it.
function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "type-body field-touch flex h-9 w-fit min-w-0 select-none items-center justify-between gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background pr-2.5 pl-3 text-foreground outline-none transition-[background-color,border-color] duration-140 ease-standard placeholder:text-muted-foreground hover:border-input focus-visible:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-pane disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive data-[size=sm]:h-8 data-placeholder:text-muted-foreground *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate [&>[data-slot=select-value]>[data-slot=status-dot]]:mr-2 [&>[data-slot=select-value]>[data-slot=status-dot]]:align-[1px] [&>[data-slot=select-value]>svg]:mr-1.5 [&>[data-slot=select-value]>svg]:inline-block [&>[data-slot=select-value]>svg]:align-[-2px] [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

// The list is a cursor.com flyout: 8px radius, a 10% border on the popover
// fill and two whisper shadows. It opens and closes instantly.
function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        align={align}
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md",
          position === "popper" &&
            "data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className
        )}
        data-align-trigger={position === "item-aligned"}
        data-slot="select-content"
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)"
          )}
          data-position={position}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        "type-caption px-2 py-1.5 text-muted-foreground data-inset:pl-7",
        className
      )}
      data-slot="select-label"
      {...props}
    />
  );
}

// A cursor.com menu row (the model picker): 32px, 4px radius, body role at
// weight 400, a `pane` highlight; the chosen option shows a check at the end.
// Put a 16px lucide icon (or a `StatusDot`, a flag) before the label as the
// first child: it shows in the row and, through `ItemText`, in the trigger.
// `description` is a trailing caption-role hint that stays out of the trigger.
function SelectItem({
  className,
  children,
  description,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  description?: React.ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "type-body relative flex min-h-8 w-full cursor-default select-none items-center gap-2 rounded-sm py-1 pr-8 pl-2 text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-pane data-inset:pl-7 data-highlighted:text-foreground data-disabled:opacity-50 [&>span:nth-child(2)]:flex [&>span:nth-child(2)]:min-w-0 [&>span:nth-child(2)]:items-center [&>span:nth-child(2)]:gap-2 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-sec [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none size-3.5 text-foreground" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {description ? (
        <span
          className="type-caption ml-auto pl-3 text-muted-foreground"
          data-slot="select-item-description"
        >
          {description}
        </span>
      ) : null}
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-slot="select-scroll-up-button"
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-slot="select-scroll-down-button"
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
