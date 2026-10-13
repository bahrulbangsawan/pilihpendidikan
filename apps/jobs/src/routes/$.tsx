import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  beforeLoad: () => {
    // Unknown URL → the not-found screen with a real 404 status.
    throw notFound();
  },
});
