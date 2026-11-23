/**
 * The page's table of contents, shared by the header tabs, the docs-style
 * left nav, the ⌘K jump list and each section's group label.
 */
export const NAV_GROUPS = [
  {
    id: "system",
    label: "System",
    sections: [
      { id: "overview", label: "Overview" },
      { id: "foundations", label: "Foundations" },
    ],
  },
  {
    id: "components",
    label: "Components",
    sections: [
      { id: "actions", label: "Actions" },
      { id: "inputs", label: "Inputs" },
      { id: "navigation", label: "Navigation" },
      { id: "data-display", label: "Data display" },
      { id: "feedback", label: "Feedback" },
      { id: "overlays", label: "Overlays" },
      { id: "conversation", label: "Conversation" },
    ],
  },
  {
    id: "guidance",
    label: "Guidance",
    sections: [
      { id: "dos-and-donts", label: "Do and don't" },
      { id: "recipes", label: "Recipes" },
      { id: "example-screen", label: "Example screen" },
    ],
  },
] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

export const SECTION_IDS: readonly string[] = NAV_GROUPS.flatMap((group) =>
  group.sections.map((section) => section.id)
);

/** The nav group a section belongs to, for its eyebrow label. */
export function groupOf(sectionId: string): NavGroup | undefined {
  return NAV_GROUPS.find((group) =>
    group.sections.some((section) => section.id === sectionId)
  );
}
