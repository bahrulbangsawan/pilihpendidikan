// CVs (12 §9): the base CVs from the CV builder, each with a link to edit it
// there and "Import facts from CV" — proposals only (05 §10), applied when the
// user picks which ones to keep.

import type { ImportCvFactsResponse } from "@pilihpendidikan/jobs-contracts/api";
import { Badge } from "@rulisme/ui/ui/badge";
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
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cvBuilderOrigin, useBaseCvs } from "@/hooks/use-cvs";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

type Proposal = ImportCvFactsResponse["proposals"][number];

function show(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function CvsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const cvs = useBaseCvs();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const bases = (cvs.data ?? []).filter((cv) => !cv.is_tailored);

  async function importFrom(cvId: string) {
    setBusy(true);
    try {
      const result = await api("POST /api/v1/profile/facts:import-cv", {
        body: { cv_id: cvId },
        idempotencyKey: newIdempotencyKey(),
      });
      setProposals(result.proposals);
      setChosen(
        new Set(
          result.proposals
            .filter((proposal) => !proposal.current)
            .map((proposal) => proposal.key)
        )
      );
    } catch {
      toast.error(t("cvs.importFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposals) {
      return;
    }
    const picked = proposals.filter((proposal) => chosen.has(proposal.key));
    setBusy(true);
    try {
      await api("PUT /api/v1/profile/facts", {
        body: {
          facts: picked.map((proposal) => ({
            key: proposal.key,
            value: proposal.value,
            source: "cv_import",
            cv_id: proposal.cv_id,
            cv_entry_id: proposal.cv_entry_id,
            ...(proposal.current
              ? { base_revision: proposal.current.revision }
              : {}),
          })),
        },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("cvs.imported", { count: picked.length }));
      setProposals(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.facts });
    } catch {
      toast.error(t("cvs.importFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="type-body max-w-2xl text-pretty">{t("cvs.intro")}</p>
      {cvs.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {cvs.isSuccess && bases.length === 0 ? (
        <p className="type-body text-muted-foreground">
          {t("cvs.empty")}{" "}
          <a
            className="text-primary hover:underline"
            href={cvBuilderOrigin()}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("cv.openBuilder")}
          </a>
        </p>
      ) : null}
      {bases.length > 0 ? (
        <div className="border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cvs.name")}</TableHead>
                <TableHead>{t("cvs.role")}</TableHead>
                <TableHead>{t("cvs.visibility")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bases.map((cv) => (
                <TableRow key={cv.id}>
                  <TableCell className="text-foreground">
                    {cv.full_name || cv.id}
                  </TableCell>
                  <TableCell>{cv.job_title}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`cvs.visibilities.${cv.visibility}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        disabled={busy}
                        onClick={() => importFrom(cv.id)}
                        size="xs"
                        variant="outline"
                      >
                        <FileDown aria-hidden="true" data-icon="inline-start" />
                        {t("cvs.import")}
                      </Button>
                      <Button asChild size="icon-xs" variant="ghost">
                        <a
                          aria-label={t("cvs.open")}
                          href={`${cvBuilderOrigin()}/?id=${encodeURIComponent(cv.id)}`}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <ExternalLink aria-hidden="true" />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <Dialog
        onOpenChange={(open) => !open && setProposals(null)}
        open={proposals !== null}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("cvs.proposalsTitle")}</DialogTitle>
            <DialogDescription>{t("cvs.proposalsBody")}</DialogDescription>
          </DialogHeader>
          {proposals && proposals.length === 0 ? (
            <p className="type-body text-muted-foreground">
              {t("cvs.noProposals")}
            </p>
          ) : null}
          <ul className="divide-y divide-line border-line border-y">
            {proposals?.map((proposal) => (
              <li className="flex items-start gap-3 py-2" key={proposal.key}>
                <Checkbox
                  aria-label={proposal.key}
                  checked={chosen.has(proposal.key)}
                  onCheckedChange={(value) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (value === true) {
                        next.add(proposal.key);
                      } else {
                        next.delete(proposal.key);
                      }
                      return next;
                    })
                  }
                />
                <div className="flex min-w-0 flex-col">
                  <span className="type-body-compact text-foreground">
                    {proposal.key}
                  </span>
                  <span className="type-caption break-words">
                    {show(proposal.value)}
                  </span>
                  {proposal.current ? (
                    <span className="type-caption text-muted-foreground">
                      {t("cvs.replaces", {
                        value: show(proposal.current.value),
                      })}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setProposals(null)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={busy || chosen.size === 0} onClick={apply}>
              {t("cvs.apply", { count: chosen.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
