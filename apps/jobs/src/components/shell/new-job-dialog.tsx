// New job by URL (`N`, 12 §2.1): `POST /api/v1/user-jobs {url}` stores a stub
// posting (the CLI or web enriches it later), then `POST /api/v1/applications`
// tracks it, and the detail page opens.

import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { safeHref } from "@/lib/safe-url";

async function trackUrl(url: string): Promise<string> {
  const { user_job } = await api("POST /api/v1/user-jobs", {
    body: { url },
    idempotencyKey: newIdempotencyKey(),
  });
  try {
    const { application } = await api("POST /api/v1/applications", {
      body: { user_job_id: user_job.id },
      idempotencyKey: newIdempotencyKey(),
    });
    return application.id;
  } catch (error) {
    // Already tracked: open the existing application.
    if (isApiError(error) && error.status === 409) {
      const detail = await api("GET /api/v1/user-jobs/{ujb_id}", {
        params: { ujb_id: user_job.id },
      });
      if (detail.application) {
        return detail.application.id;
      }
    }
    throw error;
  }
}

export function NewJobDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setUrl("");
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = safeHref(url);
    if (!href?.startsWith("http")) {
      setError(t("newJob.invalidUrl"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const appId = await trackUrl(href);
      await queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
      close(false);
      await navigate({ to: "/applications/$appId", params: { appId } });
    } catch (caught) {
      setError(
        isApiError(caught) && caught.status === 422
          ? t("newJob.unsupported")
          : t("newJob.failed")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("newJob.title")}</DialogTitle>
            <DialogDescription>{t("newJob.description")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error !== null}>
            <FieldLabel htmlFor={`${id}-url`}>
              {t("newJob.urlLabel")}
            </FieldLabel>
            <Input
              aria-describedby={`${id}-help`}
              aria-invalid={error !== null || undefined}
              autoComplete="url"
              autoFocus
              className="field-touch"
              id={`${id}-url`}
              inputMode="url"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://boards.greenhouse.io/acme/jobs/123"
              required
              type="url"
              value={url}
            />
            {error ? (
              <FieldError id={`${id}-help`}>{error}</FieldError>
            ) : (
              <FieldDescription id={`${id}-help`}>
                {t("newJob.help")}
              </FieldDescription>
            )}
          </Field>
          <DialogFooter>
            <Button
              onClick={() => close(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button aria-keyshortcuts="Enter" disabled={busy} type="submit">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {busy ? t("newJob.adding") : t("newJob.submit")}
              <Kbd aria-hidden="true">↵</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
