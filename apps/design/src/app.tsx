import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import { SiteFooter } from "./showcase/site-footer";
import { SiteHeader } from "./showcase/site-header";
import { ThemeProvider } from "./showcase/theme";
import { ActionsSection } from "./showcase/sections/actions";
import { ConversationSection } from "./showcase/sections/conversation";
import { DataDisplaySection } from "./showcase/sections/data-display";
import { DosAndDontsSection } from "./showcase/sections/dos-and-donts";
import { ExampleScreenSection } from "./showcase/sections/example-screen";
import { FeedbackSection } from "./showcase/sections/feedback";
import { FoundationsSection } from "./showcase/sections/foundations";
import { InputsSection } from "./showcase/sections/inputs";
import { NavigationSection } from "./showcase/sections/navigation";
import { OverlaysSection } from "./showcase/sections/overlays";
import { OverviewSection } from "./showcase/sections/overview";
import { RecipesSection } from "./showcase/sections/recipes";

function SkipLink() {
  return (
    <a
      className={`${buttonVariants({ size: "sm" })} sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50`}
      href="#foundations"
    >
      Skip to the system
    </a>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <SkipLink />
        <SiteHeader />
        <main>
          <OverviewSection />
          <FoundationsSection />
          <ActionsSection />
          <InputsSection />
          <NavigationSection />
          <DataDisplaySection />
          <FeedbackSection />
          <OverlaysSection />
          <ConversationSection />
          <DosAndDontsSection />
          <RecipesSection />
          <ExampleScreenSection />
        </main>
        <SiteFooter />
      </TooltipProvider>
    </ThemeProvider>
  );
}
