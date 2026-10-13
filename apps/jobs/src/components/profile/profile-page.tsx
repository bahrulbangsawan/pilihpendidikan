// Profile (12 §9): Facts, Answers, CVs — what the agent may use when it fills
// a form, and where each value came from.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { useTranslation } from "@/i18n";
import { AnswersTab } from "./answers-tab";
import { CvsTab } from "./cvs-tab";
import { FactsTab } from "./facts-tab";
import { PageGutter, PageHeader } from "@/components/shell/page";

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
      <Tabs
        className="gap-0"
        onValueChange={(value) => onTabChange(value as ProfileTab)}
        value={tab}
      >
        <PageHeader description={t("profile.intro")} title={t("profile.title")}>
          <div className="no-scrollbar -mb-px overflow-x-auto">
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
          </div>
        </PageHeader>
        <PageGutter className="py-6">
          <TabsContent value="facts">
            <FactsTab />
          </TabsContent>
          <TabsContent value="answers">
            <AnswersTab />
          </TabsContent>
          <TabsContent value="cvs">
            <CvsTab />
          </TabsContent>
        </PageGutter>
      </Tabs>
    </div>
  );
}
