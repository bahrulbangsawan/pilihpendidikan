import { createFileRoute, notFound } from "@tanstack/react-router"

export const Route = createFileRoute("/$")({
  beforeLoad: () => {
    // Unknown URL → render the app's not-found screen (wired as the router's
    // `defaultNotFoundComponent`) with a real 404 status, instead of silently
    // redirecting to `/`. The more-specific `/id` route still wins for `/id`.
    throw notFound()
  },
})
