import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { ToasterProps } from "sonner";
import { Toaster as Sonner } from "sonner";

import { buttonVariants } from "./button-variants";
import { Spinner } from "./spinner";

// Zedative toasts: each toast is a window (6px, 1px border, `shadow-float`,
// bg-2) with a body-role semibold title and a muted caption. Toasts are
// unstyled in sonner and dressed here, so sonner keeps only its own stacking
// and swipe motion. Loading uses the Blocks spinner. The `!` marks beat the
// few rules sonner applies under its dark theme whatever the toast style.
const TOAST_CLASS_NAMES: NonNullable<
  ToasterProps["toastOptions"]
>["classNames"] = {
  toast:
    "group/toast type-body flex w-(--width) items-start gap-2.5 rounded-lg border border-border bg-popover p-3 font-sans text-popover-foreground shadow-float outline-none focus-visible:shadow-float! focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2 data-[expanded=false]:data-[front=false]:*:opacity-0",
  icon: "relative mt-0.75 flex size-3.5 shrink-0 items-center justify-center text-foreground [&_svg]:size-3.5",
  loader: "text-muted-foreground",
  content: "flex min-w-0 flex-1 flex-col gap-0.5",
  title: "weight-semibold text-foreground",
  description: "type-caption text-muted-foreground!",
  actionButton: `${buttonVariants({ variant: "outline", size: "xs" })} shrink-0`,
  cancelButton: `${buttonVariants({ variant: "ghost", size: "xs" })} shrink-0`,
  closeButton:
    "order-last -my-1 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-transparent! text-muted-foreground! outline-none transition-[background-color,color] duration-150 ease-standard hover:bg-pane/70! hover:text-foreground! focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2 [&_svg]:size-3.5",
  error: "[&_[data-icon]]:text-destructive",
};

function Toaster({ ...props }: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon />,
        info: <InfoIcon />,
        warning: <TriangleAlertIcon />,
        error: <OctagonXIcon />,
        loading: <Spinner />,
        close: <XIcon />,
      }}
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        unstyled: true,
        classNames: TOAST_CLASS_NAMES,
      }}
      {...props}
    />
  );
}

export { Toaster };
