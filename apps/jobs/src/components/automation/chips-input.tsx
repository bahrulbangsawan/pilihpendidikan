// A list of short values as removable chips with an input that adds on
// Enter or comma (rule keywords, companies, locations, allowed domains).
// `normalize` can rewrite or refuse a value (domains → registrable domain).

import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Input } from "@rulisme/ui/ui/input";
import { X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { addChips } from "@/lib/rules-form";

export function ChipsInput({
  id,
  values,
  onChange,
  max,
  placeholder,
  invalidMessage,
  normalize,
  describedBy,
}: {
  id: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  max: number;
  placeholder?: string;
  /** Shown when `normalize` refuses what was typed. */
  invalidMessage?: string;
  normalize?: (raw: string) => string | null;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  function commit(): boolean {
    const raw = draft.trim();
    if (!raw) {
      return false;
    }
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const accepted: string[] = [];
    for (const part of parts) {
      const value = normalize ? normalize(part) : part;
      if (value === null) {
        setInvalid(true);
        return true;
      }
      accepted.push(value);
    }
    setInvalid(false);
    onChange(addChips(values, accepted.join(","), max));
    setDraft("");
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      if (commit()) {
        event.preventDefault();
      }
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {values.map((value) => (
            <li key={value}>
              <Badge className="pr-0.5" variant="outline">
                {value}
                <Button
                  aria-label={t("rules.removeChip", { value })}
                  className="size-4"
                  onClick={() =>
                    onChange(values.filter((entry) => entry !== value))
                  }
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="field-touch"
        disabled={values.length >= max}
        id={id}
        onBlur={() => commit()}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        value={draft}
      />
      {invalid && invalidMessage ? (
        <p className="type-caption text-destructive" role="alert">
          {invalidMessage}
        </p>
      ) : null}
    </div>
  );
}
