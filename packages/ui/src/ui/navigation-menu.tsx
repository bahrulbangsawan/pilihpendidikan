import { cva } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { NavigationMenu as NavigationMenuPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// cursor.com header nav: triggers and top-level links are pill ghost links
// (36px, body role, `pane` hover fill) with a muted ▾; the menu opens
// instantly in the 8px flyout holding 32px menu rows. The current page is
// orange (`text-link`), like the active item in Cursor's docs nav.
function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & {
  viewport?: boolean;
}) {
  return (
    <NavigationMenuPrimitive.Root
      className={cn(
        "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
        className
      )}
      data-slot="navigation-menu"
      data-viewport={viewport}
      {...props}
    >
      {children}
      {viewport && <NavigationMenuViewport />}
    </NavigationMenuPrimitive.Root>
  );
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      className={cn(
        "group flex flex-1 list-none items-center justify-center gap-0.5",
        className
      )}
      data-slot="navigation-menu-list"
      {...props}
    />
  );
}

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      className={cn("relative", className)}
      data-slot="navigation-menu-item"
      {...props}
    />
  );
}

const navigationMenuTriggerStyle = cva(
  "group/navigation-menu-trigger type-body inline-flex h-9 w-max items-center justify-center gap-1 rounded-full px-3 text-foreground outline-none transition-[background-color,color] duration-140 ease-standard hover:bg-pane focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 data-open:bg-pane data-popup-open:bg-pane data-active:text-link"
);

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger
      className={cn(navigationMenuTriggerStyle(), "group", className)}
      data-slot="navigation-menu-trigger"
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3.5 text-muted-foreground group-data-open/navigation-menu-trigger:rotate-180 group-data-popup-open/navigation-menu-trigger:rotate-180"
      />
    </NavigationMenuPrimitive.Trigger>
  );
}

function NavigationMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return (
    <NavigationMenuPrimitive.Content
      className={cn(
        "top-0 left-0 w-full p-1 md:absolute md:w-auto",
        "group-data-[viewport=false]/navigation-menu:top-full group-data-[viewport=false]/navigation-menu:mt-1.5 group-data-[viewport=false]/navigation-menu:overflow-hidden group-data-[viewport=false]/navigation-menu:rounded-lg group-data-[viewport=false]/navigation-menu:border group-data-[viewport=false]/navigation-menu:border-border group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:shadow-md",
        className
      )}
      data-slot="navigation-menu-content"
      {...props}
    />
  );
}

function NavigationMenuViewport({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    <div className="absolute top-full left-0 isolate z-50 flex justify-center">
      <NavigationMenuPrimitive.Viewport
        className={cn(
          "relative mt-1.5 h-(--radix-navigation-menu-viewport-height) w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md md:w-(--radix-navigation-menu-viewport-width)",
          className
        )}
        data-slot="navigation-menu-viewport"
        {...props}
      />
    </div>
  );
}

function NavigationMenuLink({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      className={cn(
        "type-body flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 text-foreground outline-none transition-[background-color,color] duration-140 ease-standard hover:bg-pane focus-visible:bg-pane focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:-outline-offset-2 data-active:text-link [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-slot="navigation-menu-link"
      {...props}
    />
  );
}

// A short ink bar under the open trigger, in place of an arrow.
function NavigationMenuIndicator({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Indicator>) {
  return (
    <NavigationMenuPrimitive.Indicator
      className={cn(
        "top-full z-1 flex h-1.5 items-end justify-center overflow-hidden",
        className
      )}
      data-slot="navigation-menu-indicator"
      {...props}
    >
      <div className="h-0.5 w-4 rounded-full bg-foreground" />
    </NavigationMenuPrimitive.Indicator>
  );
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
};
