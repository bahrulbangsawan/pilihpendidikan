// Checklists (06 §5): the legacy `sections` JSON, edited here and saved as a
// whole array with `base_revision` (autosave). On a conflict the sections
// merge three-way by id (item notes as text, 12 §11); when the same thing was
// changed differently, both versions are shown side by side to choose from.

import type {
  ApplicationRecord,
  LegacyJobSection,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  SECTIONS_MAX_BYTES,
  SECTIONS_MAX_ITEMS,
} from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import { Input } from "@rulisme/ui/ui/input";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import {
  applicationFieldMerger,
  APPLICATION_FIELDS,
  deepEqual,
} from "@/lib/conflict";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { writeWithConflicts } from "@/lib/revisioned-write";
import { safeHref } from "@/lib/safe-url";

const AUTOSAVE_MS = 800;
type Sections = LegacyJobSection[];

function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Size caps of 06 §5: 200 items, 64 KB serialized. */
export function sectionsWithinLimits(
  sections: Sections
): "items" | "bytes" | null {
  const items = sections.reduce(
    (total, section) => total + section.items.length,
    0
  );
  if (items > SECTIONS_MAX_ITEMS) {
    return "items";
  }
  if (
    new TextEncoder().encode(JSON.stringify(sections)).length >
    SECTIONS_MAX_BYTES
  ) {
    return "bytes";
  }
  return null;
}

function SectionsPreview({ sections }: { sections: Sections }) {
  return (
    <div className="type-caption flex flex-col gap-2">
      {sections.map((section) => (
        <div key={section.id}>
          <p className="weight-semibold text-foreground">{section.name}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.id}>
                {item.done ? "☑" : "☐"} {item.title}
                {item.notes ? (
                  <span className="block whitespace-pre-line pl-4 text-muted-foreground">
                    {item.notes}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ChecklistsTab({
  application,
}: {
  application: ApplicationRecord;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [sections, setSections] = useState<Sections>(application.sections);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [conflict, setConflict] = useState<{
    mine: Sections;
    current: ApplicationRecord;
  } | null>(null);
  const base = useRef<ApplicationRecord>(application);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  // Server updates (polls) replace the local copy unless an edit is pending.
  useEffect(() => {
    if (!dirty.current && application.revision !== base.current.revision) {
      base.current = application;
      setSections(application.sections);
    }
  }, [application]);

  const confirm = useCallback(
    (record: ApplicationRecord) => {
      base.current = record;
      dirty.current = false;
      setSections(record.sections);
      commitApplicationToBoard(queryClient, record);
      queryClient.setQueryData<{ application: ApplicationRecord }>(
        queryKeys.application(record.id),
        (detail) => (detail ? { ...detail, application: record } : detail)
      );
    },
    [queryClient]
  );

  const save = useCallback(
    async (next: Sections) => {
      const limit = sectionsWithinLimits(next);
      if (limit) {
        setStatus("error");
        toast.error(t(`checklists.limit.${limit}`));
        return;
      }
      setStatus("saving");
      try {
        const outcome = await writeWithConflicts<ApplicationRecord>({
          base: base.current,
          changes: { sections: next },
          fields: APPLICATION_FIELDS,
          merge: applicationFieldMerger,
          send: async (baseRevision, changes) =>
            (
              await api("PATCH /api/v1/applications/{app_id}", {
                params: { app_id: application.id },
                body: {
                  sections: changes.sections as Sections,
                  base_revision: baseRevision,
                },
                idempotencyKey: newIdempotencyKey(),
              })
            ).application,
        });
        if (outcome.kind === "overlap") {
          setStatus("error");
          setConflict({ mine: next, current: outcome.current });
          return;
        }
        confirm(outcome.record);
        setStatus("saved");
        if (outcome.kind === "saved" && outcome.mergedFrom.length > 0) {
          toast.success(t("checklists.merged"));
        }
      } catch (error) {
        setStatus("error");
        toast.error(
          isApiError(error) && error.status === 413
            ? t("checklists.limit.bytes")
            : t("checklists.saveFailed")
        );
      }
    },
    [application.id, confirm, t]
  );

  const update = useCallback(
    (next: Sections) => {
      setSections(next);
      dirty.current = true;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => {
        timer.current = null;
        save(next);
      }, AUTOSAVE_MS);
    },
    [save]
  );

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    []
  );

  const editSection = (sectionId: string, patch: Partial<LegacyJobSection>) =>
    update(
      sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section
      )
    );
  const editItem = (
    sectionId: string,
    itemId: string,
    patch: Partial<LegacyJobSection["items"][number]>
  ) =>
    update(
      sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            }
          : section
      )
    );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-subtitle weight-semibold">
          {t("checklists.heading")}
        </h2>
        <span className="type-caption text-muted-foreground" role="status">
          {status === "idle" ? "" : t(`checklists.status.${status}`)}
        </span>
      </div>
      {sections.length === 0 ? (
        <p className="type-body text-muted-foreground">
          {t("checklists.empty")}
        </p>
      ) : null}
      {sections.map((section) => (
        <section
          aria-label={section.name || t("checklists.untitled")}
          className="flex flex-col gap-2 border border-border bg-card p-3"
          key={section.id}
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("checklists.sectionName")}
              className="field-touch weight-semibold h-8"
              onChange={(event) =>
                editSection(section.id, { name: event.target.value })
              }
              placeholder={t("checklists.untitled")}
              value={section.name}
            />
            <Button
              aria-label={t("checklists.deleteSection")}
              onClick={() =>
                update(sections.filter((entry) => entry.id !== section.id))
              }
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {section.items.map((item) => {
              const href = safeHref(item.url);
              return (
                <li
                  className="flex flex-col gap-1.5 border-line border-t pt-2"
                  key={item.id}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      aria-label={t("checklists.done")}
                      checked={item.done}
                      onCheckedChange={(value) =>
                        editItem(section.id, item.id, { done: value === true })
                      }
                    />
                    <Input
                      aria-label={t("checklists.itemTitle")}
                      className={`field-touch h-8 ${item.done ? "text-muted-foreground line-through" : ""}`}
                      onChange={(event) =>
                        editItem(section.id, item.id, {
                          title: event.target.value,
                        })
                      }
                      value={item.title}
                    />
                    {href ? (
                      <Button asChild size="icon-sm" variant="ghost">
                        <a
                          aria-label={t("checklists.openLink")}
                          href={href}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <ExternalLink aria-hidden="true" />
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      aria-label={t("checklists.deleteItem")}
                      onClick={() =>
                        editSection(section.id, {
                          items: section.items.filter(
                            (entry) => entry.id !== item.id
                          ),
                        })
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
                    <Input
                      aria-label={t("checklists.url")}
                      className="field-touch h-8"
                      onChange={(event) =>
                        editItem(section.id, item.id, {
                          url: event.target.value,
                        })
                      }
                      placeholder={t("checklists.url")}
                      type="url"
                      value={item.url}
                    />
                    <Textarea
                      aria-label={t("checklists.notes")}
                      className="field-touch min-h-8 sm:col-span-2"
                      onChange={(event) =>
                        editItem(section.id, item.id, {
                          notes: event.target.value,
                        })
                      }
                      placeholder={t("checklists.notes")}
                      value={item.notes}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            className="self-start"
            onClick={() =>
              editSection(section.id, {
                items: [
                  ...section.items,
                  {
                    id: newKey("item"),
                    title: "",
                    notes: "",
                    url: "",
                    done: false,
                  },
                ],
              })
            }
            size="xs"
            variant="ghost"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t("checklists.addItem")}
          </Button>
        </section>
      ))}
      <Button
        className="self-start"
        onClick={() =>
          update([...sections, { id: newKey("section"), name: "", items: [] }])
        }
        size="sm"
        variant="outline"
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t("checklists.addSection")}
      </Button>

      <Dialog
        onOpenChange={(open) => !open && setConflict(null)}
        open={conflict !== null}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("checklists.conflictTitle")}</DialogTitle>
            <DialogDescription>
              {t("checklists.conflictBody")}
            </DialogDescription>
          </DialogHeader>
          {conflict ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="flex flex-col gap-2 border border-border p-3">
                <h3 className="type-body weight-semibold">
                  {t("checklists.yourVersion")}
                </h3>
                <SectionsPreview sections={conflict.mine} />
              </section>
              <section className="flex flex-col gap-2 border border-border p-3">
                <h3 className="type-body weight-semibold">
                  {t("checklists.theirVersion")}
                </h3>
                <SectionsPreview sections={conflict.current.sections} />
              </section>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => {
                if (conflict) {
                  confirm(conflict.current);
                  setStatus("idle");
                }
                setConflict(null);
              }}
              variant="outline"
            >
              {t("conflict.keepTheirs")}
            </Button>
            <Button
              onClick={() => {
                if (conflict) {
                  base.current = conflict.current;
                  const mine = conflict.mine;
                  setConflict(null);
                  if (!deepEqual(mine, conflict.current.sections)) {
                    save(mine);
                  }
                }
              }}
            >
              {t("conflict.applyMine")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
