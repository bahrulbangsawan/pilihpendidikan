import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$")({
  beforeLoad: ({ params }) => {
    // Allow the /id route to pass through (handled by id.tsx)
    if (params._splat === "id") {
      return
    }
    throw redirect({
      to: "/",
      search: { cv: undefined, print: undefined, template: undefined },
    })
  },
})
