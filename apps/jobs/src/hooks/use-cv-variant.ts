// A CV variant's detail (05 §7 `GET /cv-variants/{id}?include=cv_data`: the
// record, its file, the tailored CVData for entry labels, "edited after
// approval") and the in-browser rendering of a `generating` variant (08
// §6.2): while the application detail is open and the tailored document
// exists without a PDF, this tab renders and uploads it — the same module as
// the render page — instead of waiting for a CLI.

import type { CvVariantRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import type { RenderErrorCode } from "@/lib/render-cv";
import { renderCvVariantOnce } from "@/lib/render-cv";

const GENERATING_POLL_MS = 2000;

export function useCvVariantDetail(cvvId: string | null, generating: boolean) {
  return useQuery({
    queryKey: queryKeys.cvVariant(cvvId ?? "none"),
    enabled: cvvId !== null,
    queryFn: () =>
      api("GET /api/v1/cv-variants/{cvv_id}", {
        params: { cvv_id: cvvId ?? "" },
        query: { include: "cv_data" },
      }),
    refetchInterval: generating ? GENERATING_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** True when this tab should render the variant's PDF itself (08 §6.2). */
export function needsInBrowserRender(
  variant: Pick<CvVariantRecord, "status" | "tailored_cv_id" | "file_id">
): boolean {
  return (
    variant.status === "generating" &&
    variant.tailored_cv_id !== null &&
    variant.file_id === null
  );
}

export type InBrowserRenderState =
  | { state: "idle" }
  | { state: "rendering" }
  | { state: "done"; fileId: string }
  | { state: "error"; code: RenderErrorCode };

export function useInBrowserRender(
  variant: CvVariantRecord | undefined,
  applicationId: string
): InBrowserRenderState & { retry: () => void } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InBrowserRenderState>({
    state: "idle",
  });
  const [attempt, setAttempt] = useState(0);
  const started = useRef(new Set<string>());
  const wanted = variant ? needsInBrowserRender(variant) : false;
  const variantId = variant?.id ?? null;

  useEffect(() => {
    if (!(wanted && variantId)) {
      return;
    }
    const key = `${variantId}:${attempt}`;
    if (started.current.has(key)) {
      return;
    }
    started.current.add(key);
    let active = true;
    setStatus({ state: "rendering" });
    renderCvVariantOnce(variantId, null).then(async (outcome) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.cvVariant(variantId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.application(applicationId),
        }),
      ]);
      if (!active) {
        return;
      }
      setStatus(
        outcome.status === "done"
          ? { state: "done", fileId: outcome.file_id }
          : { state: "error", code: outcome.code }
      );
    });
    return () => {
      active = false;
    };
  }, [wanted, variantId, attempt, applicationId, queryClient]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...status, retry };
}
