import { createFileRoute } from "@tanstack/react-router";
import { SERVICES } from "@/config/services";
import { buildLlmsTxt } from "@/lib/discovery";

// Generated from SERVICES so it only ever lists live services.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildLlmsTxt(SERVICES), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        }),
    },
  },
});
