import { createFileRoute } from "@tanstack/react-router";
import { BotPage } from "@/components/bot-page";
import { SERVICES } from "@/config/services";

export const Route = createFileRoute("/bot")({
  head: () => ({
    meta: [
      { title: "The pilih-jobs crawler · pilihpendidikan" },
      {
        name: "description",
        content:
          "Who the pilih-jobs crawler is, what it fetches, the rules it keeps and how to opt out.",
      },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <BotPage services={SERVICES} />;
}
