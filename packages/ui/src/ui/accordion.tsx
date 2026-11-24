import { MinusIcon, PlusIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// cursor.com FAQ (the pricing page): full-width rows ruled by 10% `border`
// lines, a 16px weight-400 question ending in a muted `+` that turns into
// `−`, and the answer in muted body text with orange links. Rows open and
// close instantly; nothing animates the height or the icon.
function Accordion({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      className={cn("flex w-full flex-col", className)}
      data-slot="accordion"
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn("border-border border-b last:border-b-0", className)}
      data-slot="accordion-item"
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "group/accordion-trigger type-subtitle relative flex flex-1 items-start justify-between gap-4 py-4 text-left text-foreground outline-none transition-[color] duration-140 ease-standard hover:text-ink-sec focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:shrink-0 **:data-[slot=accordion-trigger-icon]:translate-y-0.5 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className
        )}
        data-slot="accordion-trigger"
        {...props}
      >
        {children}
        <PlusIcon
          aria-hidden="true"
          className="pointer-events-none group-aria-expanded/accordion-trigger:hidden"
          data-slot="accordion-trigger-icon"
        />
        <MinusIcon
          aria-hidden="true"
          className="pointer-events-none hidden group-aria-expanded/accordion-trigger:block"
          data-slot="accordion-trigger-icon"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className="overflow-hidden"
      data-slot="accordion-content"
      {...props}
    >
      <div
        className={cn(
          "type-body pb-4 text-muted-foreground [&_a]:text-link [&_a]:hover:text-link/75 [&_p:not(:last-child)]:mb-3",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
