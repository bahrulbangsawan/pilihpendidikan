// A copyable CLI command (12 §4 empty states, 12 §7 / 22 §12 install steps):
// the command in a monospace-free caption chip (Inter only, DESIGN.md) with a
// copy button. Commands come from cli-commands.json or are built from ids,
// never from untrusted text.

import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";

const COPIED_MS = 1500;

/** Writes `text` to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyCommand({
  command,
  className,
  label,
}: {
  command: string;
  className?: string;
  /** Accessible name of the copy button; defaults to "Copy command". */
  label?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-line bg-pane-2 pl-2",
        className
      )}
      data-slot="copy-command"
    >
      <code className="type-caption min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 font-sans text-foreground">
        {command}
      </code>
      <Button
        aria-label={copied ? t("copy.copied") : (label ?? t("copy.copy"))}
        onClick={async () => setCopied(await copyText(command))}
        size="icon-xs"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copy.copied") : ""}
      </span>
    </div>
  );
}
