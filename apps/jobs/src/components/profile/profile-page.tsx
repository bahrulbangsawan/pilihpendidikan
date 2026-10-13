// Profile (12 §9): Facts, Answers, CVs — what the agent may use when it fills
// a form, and where each value came from.

import { Band, Rail } from "@rulisme/ui/ui/rails";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { useTranslation } from "@/i18n";
import { AnswersTab } from "./answers-tab";
import { CvsTab } from "./cvs-tab";
import { FactsTab } from "./facts-tab";

export type ProfileTab = "facts" | "answers" | "cvs";

export function ProfilePage({
  tab,
  onTabChange,
}: {
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <Band>
        <Rail className="flex flex-col gap-1 px-4 py-6 sm:px-8" nodes={false}>
          <h1 className="type-title">{t("profile.title")}</h1>
          <p className="type-caption max-w-2xl text-muted-foreground">
            {t("profile.intro")}
          </p>
        </Rail>
      </Band>
      <Tabs
        className="gap-0"
        onValueChange={(value) => onTabChange(value as ProfileTab)}
        value={tab}
      >
        <Band>
          <Rail
            className="no-scrollbar overflow-x-auto px-4 sm:px-8"
            nodes={false}
          >
            <TabsList
              aria-label={t("profile.tabsLabel")}
              className="border-b-0"
              variant="line"
            >
              <TabsTrigger value="facts">{t("profile.tabs.facts")}</TabsTrigger>
              <TabsTrigger value="answers">
                {t("profile.tabs.answers")}
              </TabsTrigger>
              <TabsTrigger value="cvs">{t("profile.tabs.cvs")}</TabsTrigger>
            </TabsList>
          </Rail>
        </Band>
        <Rail className="px-4 py-6 sm:px-8" nodes={false}>
          <TabsContent value="facts">
            <FactsTab />
          </TabsContent>
          <TabsContent value="answers">
            <AnswersTab />
          </TabsContent>
          <TabsContent value="cvs">
            <CvsTab />
          </TabsContent>
        </Rail>
      </Tabs>
    </div>
  );
}
