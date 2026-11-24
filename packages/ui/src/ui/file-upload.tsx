import { UploadIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";
import { useRef, useState } from "react";
import { cn } from "../lib/utils";

// File pickers (reui's file upload), so apps never render a raw
// <input type="file">. `FileTrigger` turns its one child (a Button, or a
// TooltipTrigger around one) into the picker: a click opens the browser's
// file dialog through a hidden input. `FileDropZone` is the drop target: an
// 8px dashed field with an upload icon, a title and a hint, that also opens
// the dialog on click, Enter or Space. Both hand back plain `File[]` and
// reset the input, so picking the same file twice fires again.

interface FilePickerProps {
  /** The input's `accept`, e.g. "image/*" or ".json". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Called with the chosen (or dropped) files; never with an empty list. */
  onFilesSelect: (files: File[]) => void;
}

function useHiddenFileInput({
  accept,
  multiple,
  disabled,
  onFilesSelect,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      accept={accept}
      aria-hidden="true"
      className="hidden"
      data-slot="file-input"
      disabled={disabled}
      multiple={multiple}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length > 0) {
          onFilesSelect(files);
        }
      }}
      ref={inputRef}
      tabIndex={-1}
      type="file"
    />
  );
  const open = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };
  return { input, open };
}

function FileTrigger({
  children,
  ...picker
}: FilePickerProps & { children: React.ReactElement }) {
  const { input, open } = useHiddenFileInput(picker);
  return (
    <>
      <Slot.Root data-slot="file-trigger" onClick={open}>
        {children}
      </Slot.Root>
      {input}
    </>
  );
}

function acceptsFile(file: File, accept?: string): boolean {
  if (!accept) {
    return true;
  }
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (rule.startsWith(".")) {
      return file.name.toLowerCase().endsWith(rule);
    }
    if (rule.endsWith("/*")) {
      return file.type.startsWith(rule.slice(0, -1));
    }
    return file.type === rule;
  });
}

function FileDropZone({
  className,
  title = "Drop a file here or click to browse",
  description,
  icon,
  accept,
  multiple,
  disabled,
  onFilesSelect,
  ...props
}: Omit<React.ComponentProps<"button">, "title" | "onClick" | "type"> &
  FilePickerProps & {
    title?: React.ReactNode;
    description?: React.ReactNode;
    icon?: React.ReactNode;
  }) {
  const [dragging, setDragging] = useState(false);
  const { input, open } = useHiddenFileInput({
    accept,
    multiple,
    disabled,
    onFilesSelect,
  });

  return (
    <>
      <button
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-input border-dashed bg-background px-4 py-6 text-center outline-none transition-[background-color,border-color] duration-140 ease-standard hover:border-ring/40 hover:bg-pane focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-pane disabled:opacity-60 data-dragging:border-ring data-dragging:bg-pane",
          className
        )}
        data-dragging={dragging || undefined}
        data-slot="file-drop-zone"
        disabled={disabled}
        onClick={open}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setDragging(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) {
            return;
          }
          const files = Array.from(event.dataTransfer.files).filter((file) =>
            acceptsFile(file, accept)
          );
          const chosen = multiple ? files : files.slice(0, 1);
          if (chosen.length > 0) {
            onFilesSelect(chosen);
          }
        }}
        type="button"
        {...props}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-pane-2 text-ink-sec [&_svg:not([class*='size-'])]:size-4">
          {icon ?? <UploadIcon aria-hidden="true" />}
        </span>
        <span className="type-body text-foreground">{title}</span>
        {description ? (
          <span className="type-caption text-muted-foreground">
            {description}
          </span>
        ) : null}
      </button>
      {input}
    </>
  );
}

export { FileDropZone, FileTrigger };
export type { FilePickerProps };
