// biome-ignore-all lint/style/useFilenamingConvention: TanStack splat route file name.
import { createFileRoute } from "@tanstack/react-router";
import { downloadHeaders, emlHeaders, matchDownloadPath } from "@/lib/download";
import { buildEmlDownload } from "@/lib/eml-download";
import { readCurrentSession, requestContext } from "@/server/runtime.server";

// GET /download/<api path>: streams an interview .ics or a file's content
// from the api with the session bearer, which never reaches the browser, and
// builds the .eml of an approved email draft (09 §6.1).
export const Route = createFileRoute("/download/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const target = matchDownloadPath(params._splat ?? "");
        if (!target) {
          return new Response("Not found", { status: 404 });
        }
        const context = requestContext();
        const { session } = await readCurrentSession(context);
        if (!session) {
          return new Response("Sign in first", { status: 401 });
        }
        if (target.kind === "eml") {
          const built = await buildEmlDownload(
            target.appId,
            target.emlId,
            session.bearer,
            {
              fetchApi: context.deps.fetchApi,
              now: () => Date.now(),
              random: (size) => crypto.getRandomValues(new Uint8Array(size)),
              sessionEmail: session.email,
            }
          );
          if (!built.ok) {
            return new Response(built.message, {
              status: built.status,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          }
          return new Response(built.bytes, {
            status: 200,
            headers: emlHeaders(built.fileName, built.bytes.length),
          });
        }
        let upstream: Response;
        try {
          upstream = await context.deps.fetchApi(target.apiPath, {
            headers: {
              Authorization: `Bearer ${session.bearer}`,
              "X-Pilih-Client": "web/1",
            },
          });
        } catch {
          return new Response("The API could not be reached.", { status: 502 });
        }
        if (!upstream.ok) {
          return new Response(
            upstream.status === 404 ? "Not found" : "Download failed",
            {
              status: upstream.status === 404 ? 404 : 502,
            }
          );
        }
        const inline = new URL(request.url).searchParams.get("inline") === "1";
        return new Response(upstream.body, {
          status: 200,
          headers: downloadHeaders(upstream.headers, inline),
        });
      },
    },
  },
});
