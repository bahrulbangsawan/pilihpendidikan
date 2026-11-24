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

// cursor.com toasts: each toast is a window (8px, 10% border, the soft drop,
// popover fill) with a body-role title at weight 400 and a muted caption. Toasts are
// unstyled in sonner and dressed here, so sonner keeps only its own stacking
// and swipe motion. Loading uses the Blocks spinner. The `!` marks beat the
// few rules sonner applies under its dark theme whatever the toast style.
const TOAST_CLASS_NAMES: NonNullable<
  ToasterProps["toastOptions"]
>["classNames"] = {
  toast:
    "group/toast type-body flex w-(--width) items-start gap-2.5 rounded-lg border border-border bg-popover p-3 font-sans text-popover-foreground shadow-lg outline-none focus-visible:shadow-lg! focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2 data-[expanded=false]:data-[front=false]:*:opacity-0",
  icon: "relative mt-0.75 flex size-3.5 shrink-0 items-center justify-center text-foreground [&_svg]:size-3.5",
  loader: "text-muted-foreground",
  content: "flex min-w-0 flex-1 flex-col gap-0.5",
  title: "text-foreground",
  description: "type-caption text-muted-foreground!",
  actionButton: `${buttonVariants({ variant: "outline", size: "xs" })} shrink-0`,
  cancelButton: `${buttonVariants({ variant: "ghost", size: "xs" })} shrink-0`,
  closeButton:
    "order-last -my-1 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-transparent! text-muted-foreground! outline-none transition-[background-color,color] duration-140 ease-standard hover:bg-pane! hover:text-foreground! focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2 [&_svg]:size-3.5",
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
