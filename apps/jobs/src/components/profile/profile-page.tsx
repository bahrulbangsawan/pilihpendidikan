// Profile (12 §9), laid out like reui's account-settings block: a left
// sub-nav (Facts, Answers, CVs) and the section's cards of rows.

import { FileText, MessageSquareText, UserRound } from "lucide-react";
import type { SubNavItem } from "@rulisme/ui/blocks/settings";
import { SubNavLayout } from "@rulisme/ui/blocks/settings";
import { useTranslation } from "@/i18n";
import { AnswersTab } from "./answers-tab";
import { CvsTab } from "./cvs-tab";
import { FactsTab } from "./facts-tab";

export type ProfileTab = "facts" | "answers" | "cvs";

const TAB_ICONS = {
  facts: UserRound,
  answers: MessageSquareText,
  cvs: FileText,
} as const;

const TABS: readonly ProfileTab[] = ["facts", "answers", "cvs"];

export function ProfilePage({
  tab,
  onTabChange,
}: {
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
}) {
  const { t } = useTranslation();
  const items: SubNavItem<ProfileTab>[] = TABS.map((value) => ({
    value,
    icon: TAB_ICONS[value],
    label: t(`profile.tabs.${value}`),
  }));
  return (
    <SubNavLayout
      description={t("profile.intro")}
      items={items}
      label={t("profile.tabsLabel")}
      onChange={onTabChange}
      title={t("profile.title")}
      value={tab}
    >
      {tab === "facts" ? <FactsTab /> : null}
      {tab === "answers" ? <AnswersTab /> : null}
      {tab === "cvs" ? <CvsTab /> : null}
    </SubNavLayout>
  );
}
