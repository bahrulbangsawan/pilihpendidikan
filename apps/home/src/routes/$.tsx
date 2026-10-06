import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  beforeLoad: () => {
    // Unknown URL → the not-found screen with a real 404 status. The more
    // specific `/id` and `/llms.txt` routes still win.
    throw notFound();
  },
});
