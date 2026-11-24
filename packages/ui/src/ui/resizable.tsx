import type {
  GroupProps,
  PanelProps,
  SeparatorProps,
} from "react-resizable-panels";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "../lib/utils";

// cursor.com resizable panes: the handle is a 1px 10% `border` rule, like
// the pane dividers it splits, with an optional small pill grip. The rule
// darkens while hovered or dragged; keyboard focus takes the ring.
function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      data-slot="resizable-panel-group"
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      className={cn(
        "relative flex w-px items-center justify-center bg-border outline-none transition-[background-color] duration-140 ease-standard after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 data-[separator=active]:bg-muted-foreground data-[separator=hover]:bg-muted-foreground/60",
        className
      )}
      data-slot="resizable-handle"
      {...props}
    >
      {withHandle && (
        <div className="z-10 h-6 w-1 shrink-0 rounded-full bg-input [[aria-orientation=horizontal]>&]:h-1 [[aria-orientation=horizontal]>&]:w-6" />
      )}
    </Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
