import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  beforeLoad: ({ params }) => {
    // Allow /id route to pass through (handled by id.tsx)
    if (params._splat === "id") {
      return;
    }
    throw redirect({ to: "/" });
  },
});
