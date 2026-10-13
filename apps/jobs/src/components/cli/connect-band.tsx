// "Connect your computer" (12 §7, 22 §12): install (OS tabs), the browser,
// sign in, verify (the page polls devices every 3 s and shows the new one),
// next steps and troubleshooting. Every command comes from
// cli-commands.json. With no devices yet this band is the page's hero.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import type { DevicePlatform } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rulisme/ui/ui/collapsible";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Band } from "@rulisme/ui/ui/rails";
import { Spinner } from "@rulisme/ui/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { AppLink } from "@/components/app-link";
import { CopyCommand, copyText } from "@/components/copy-command";
import { useTranslation } from "@/i18n";
import type { CliStep } from "@/lib/devices-install";
import {
  CLI_COMMANDS,
  INSTALL_PLATFORMS,
  installCommand,
} from "@/lib/devices-install";
import { detectPlatform } from "@/lib/devices-model";
import { platformLabel } from "@/lib/labels";
import { safeHref } from "@/lib/safe-url";
import { translateOr } from "@/lib/sources-model";
import { PageGutter } from "@/components/shell/page";

const COPIED_MS = 1500;

/** The visitor's OS, read after mount (the server renders macOS). */
function usePlatform(): [DevicePlatform, (next: DevicePlatform) => void] {
  const [platform, setPlatform] = useState<DevicePlatform>("macos");
  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, navigator.platform));
  }, []);
  return [platform, setPlatform];
}

function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="type-caption weight-semibold flex size-6 shrink-0 items-center justify-center rounded-sm border border-line bg-card text-foreground tabular-nums"
    >
      {n}
    </span>
  );
}

function Step({
  n,
  title,
  note,
  children,
}: {
  n: number;
  title: string;
  note?: string | null;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <StepNumber n={n} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="type-body weight-semibold text-foreground">{title}</h3>
        {children}
        {note ? (
          <p className="type-caption text-muted-foreground">{note}</p>
        ) : null}
      </div>
    </li>
  );
}

/** The install command with its `C` copy button (22 §12). */
function InstallCommand({
  platform,
  primary,
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
  platform: DevicePlatform;
  primary: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <code className="type-body min-w-0 max-w-full overflow-x-auto whitespace-nowrap rounded-sm border border-line bg-pane-2 px-2 py-1 font-sans text-foreground">
        {installCommand(platform)}
      </code>
      <Button
        aria-keyshortcuts="C"
        onClick={onCopy}
        size="sm"
        variant={primary ? "default" : "outline"}
      >
        {copied ? (
          <Check aria-hidden="true" data-icon="inline-start" />
        ) : (
          <Copy aria-hidden="true" data-icon="inline-start" />
        )}
        {copied ? t("copy.copied") : t("cliPage.install.copy")}
        <Kbd aria-hidden="true">C</Kbd>
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copy.copied") : ""}
      </span>
    </div>
  );
}

function stepText(
  t: (key: string) => string,
  step: CliStep,
  field: "title" | "note"
): string {
  const fallback = field === "title" ? step.title : (step.note ?? "");
  return translateOr(t, `cliPage.steps.${step.id}.${field}`, fallback);
}

function InstallStep({
  n,
  step,
  primary,
  platform,
  onPlatformChange,
  copied,
  onCopy,
}: {
  copied: boolean;
  n: number;
  onCopy: () => void;
  onPlatformChange: (platform: DevicePlatform) => void;
  platform: DevicePlatform;
  primary: boolean;
  step: CliStep;
}) {
  const { t } = useTranslation();
  const id = useId();
  const uvDocs = safeHref(CLI_COMMANDS.install_uv.docs_url);
  return (
    <Step
      n={n}
      note={stepText(t, step, "note")}
      title={stepText(t, step, "title")}
    >
      <Tabs
        className="gap-3"
        onValueChange={(value) => onPlatformChange(value as DevicePlatform)}
        value={platform}
      >
        <TabsList aria-label={t("cliPage.install.osLabel")} variant="line">
          {INSTALL_PLATFORMS.map((value) => (
            <TabsTrigger id={`${id}-${value}`} key={value} value={value}>
              {platformLabel(t, value)}
            </TabsTrigger>
          ))}
        </TabsList>
        {INSTALL_PLATFORMS.map((value) => (
          <TabsContent
            className="flex flex-col gap-3"
            key={value}
            value={value}
          >
            <InstallCommand
              copied={copied}
              onCopy={onCopy}
              platform={value}
              primary={primary}
            />
            <p className="type-caption text-muted-foreground">
              {t("cliPage.install.requirements")}
            </p>
            <div className="flex flex-col gap-1.5">
              <p className="type-caption text-muted-foreground">
                {t("cliPage.install.uv")}
              </p>
              <CopyCommand
                className="self-start"
                command={CLI_COMMANDS.install_uv[value]}
              />
              {uvDocs ? (
                <a
                  className="type-caption inline-flex items-center gap-1 self-start text-primary underline-offset-4 hover:underline"
                  href={uvDocs}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t("cliPage.install.uvDocs")}
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              ) : null}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex flex-col gap-1.5">
        <p className="type-caption text-muted-foreground">
          {t("cliPage.install.alternatives")}
        </p>
        <ul className="flex flex-col gap-1.5">
          {CLI_COMMANDS.alternatives.map((alternative) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-2"
              key={alternative.id}
            >
              <span className="type-caption w-40 shrink-0 text-foreground">
                {translateOr(
                  t,
                  `cliPage.alternatives.${alternative.id}`,
                  alternative.label
                )}
              </span>
              {alternative.available ? (
                <CopyCommand command={alternative.command} />
              ) : (
                <Badge variant="outline">{t("cliPage.install.soon")}</Badge>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Step>
  );
}

function VerifyStatus({
  devices,
  connected,
  waiting,
}: {
  devices: readonly DeviceView[];
  connected: DeviceView | null;
  waiting: boolean;
}) {
  const { t } = useTranslation();
  if (connected) {
    return (
      <p
        className="type-body inline-flex items-center gap-2 text-foreground"
        role="status"
      >
        <Check aria-hidden="true" className="size-4 text-primary" />
        {t("cliPage.verify.connected", { name: connected.name })}
      </p>
    );
  }
  if (devices.length > 0) {
    return (
      <p className="type-caption text-muted-foreground" role="status">
        {devices.length === 1
          ? t("cliPage.verify.countOne")
          : t("cliPage.verify.countMany", { count: devices.length })}
      </p>
    );
  }
  return (
    <p
      className="type-caption inline-flex items-center gap-2 text-muted-foreground"
      role="status"
    >
      {waiting ? <Spinner /> : null}
      {t("cliPage.verify.waiting")}
    </p>
  );
}

/**
 * The sign-in command: like CopyCommand, but copying it also starts the
 * 3 s watch for the new device (22 §12 step 4).
 */
function WatchedCommand({
  command,
  onCopy,
}: {
  command: string;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1 self-start rounded-sm border border-line bg-pane-2 pl-2"
      data-slot="copy-command"
    >
      <code className="type-caption min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 font-sans text-foreground">
        {command}
      </code>
      <Button
        aria-label={copied ? t("copy.copied") : t("copy.copy")}
        onClick={async () => {
          onCopy();
          setCopied(await copyText(command));
        }}
        size="icon-xs"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copy.copied") : ""}
      </span>
    </div>
  );
}

function StepCommands({
  step,
  platform,
  onCopy,
}: {
  onCopy?: () => void;
  platform: DevicePlatform;
  step: CliStep;
}) {
  const command = step.commands[platform];
  return onCopy ? (
    <WatchedCommand command={command} onCopy={onCopy} />
  ) : (
    <CopyCommand className="self-start" command={command} />
  );
}

function Troubleshooting() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {CLI_COMMANDS.troubleshooting.map((item) => (
          <li className="flex min-w-0 flex-col gap-1" key={item.id}>
            <span className="type-caption text-foreground">
              {translateOr(t, `cliPage.troubleshooting.${item.id}`, item.label)}
            </span>
            <CopyCommand className="self-start" command={item.command} />
          </li>
        ))}
      </ul>
      <p className="type-caption max-w-2xl text-muted-foreground">
        {t("cliPage.troubleshooting.keyring")}
      </p>
      <p className="type-caption max-w-2xl text-muted-foreground">
        {t("cliPage.troubleshooting.wsl")}
      </p>
      <div className="flex flex-col gap-2">
        <h4 className="type-caption weight-semibold text-foreground">
          {t("cliPage.stepUp.title")}
        </h4>
        <ul className="flex flex-col gap-2">
          {CLI_COMMANDS.step_up.map((item) => (
            <li className="flex min-w-0 flex-col gap-1" key={item.id}>
              <span className="type-caption text-muted-foreground">
                {translateOr(t, `cliPage.stepUp.${item.id}`, item.label)}
              </span>
              <CopyCommand className="self-start" command={item.command} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export interface ConnectBandProps {
  /** Newest device connected in the last 5 min. */
  connected: DeviceView | null;
  devices: readonly DeviceView[];
  /** No device yet: the band is the hero and open. */
  hero: boolean;
  /** The user copied the login command (start the 3 s watch). */
  onLoginCopied: () => void;
  /** Polling every 3 s right now. */
  waiting: boolean;
}

export function ConnectBand({
  hero,
  devices,
  connected,
  waiting,
  onLoginCopied,
}: ConnectBandProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(hero);
  const [platform, setPlatform] = usePlatform();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (hero) {
      setOpen(true);
    }
  }, [hero]);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyInstall(fromShortcut: boolean) {
    const done = await copyText(installCommand(platform));
    setCopied(done);
    if (!fromShortcut) {
      return;
    }
    if (done) {
      toast.success(t("cliPage.install.copiedToast"));
    } else {
      toast.error(t("cliPage.install.copyFailed"));
    }
  }

  // `C` copies the selected OS's install command, even while the steps are
  // folded away (22 §12).
  useShortcut("c", () => {
    copyInstall(true);
  });

  const steps = CLI_COMMANDS.steps;
  // The hero is the page's only heading level 1 (12 §7: title role).
  const Heading = hero ? "h1" : "h2";
  const body = (
    <ol className="flex flex-col gap-6" aria-label={t("cliPage.connectSteps")}>
      {steps.map((step, index) => {
        const n = index + 1;
        if (step.id === "install") {
          return (
            <InstallStep
              copied={copied}
              key={step.id}
              n={n}
              onCopy={() => copyInstall(false)}
              onPlatformChange={setPlatform}
              platform={platform}
              primary={hero}
              step={step}
            />
          );
        }
        if (step.id === "login") {
          return (
            <Step key={step.id} n={n} title={stepText(t, step, "title")}>
              <StepCommands
                onCopy={onLoginCopied}
                platform={platform}
                step={step}
              />
              <p className="type-caption max-w-2xl text-muted-foreground">
                {t("cliPage.login.explain", {
                  example: t("cliPage.login.example", {
                    os: platformLabel(t, platform),
                  }),
                })}
              </p>
            </Step>
          );
        }
        if (step.id === "verify") {
          return (
            <Step
              key={step.id}
              n={n}
              note={stepText(t, step, "note")}
              title={stepText(t, step, "title")}
            >
              <StepCommands platform={platform} step={step} />
              <VerifyStatus
                connected={connected}
                devices={devices}
                waiting={waiting}
              />
            </Step>
          );
        }
        if (step.id === "next") {
          return (
            <Step
              key={step.id}
              n={n}
              note={stepText(t, step, "note")}
              title={stepText(t, step, "title")}
            >
              <AppLink
                className="type-caption self-start text-primary underline-offset-4 hover:underline"
                href="/sources"
              >
                {t("cliPage.next.addSources")}
              </AppLink>
              <StepCommands platform={platform} step={step} />
            </Step>
          );
        }
        return (
          <Step
            key={step.id}
            n={n}
            note={stepText(t, step, "note")}
            title={stepText(t, step, "title")}
          >
            <StepCommands platform={platform} step={step} />
          </Step>
        );
      })}
    </ol>
  );

  return (
    <Band>
      <PageGutter className="flex flex-col gap-5 py-6">
        <Collapsible onOpenChange={setOpen} open={open}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Heading
                className={cn(
                  hero ? "type-title" : "type-subtitle weight-semibold",
                  "text-foreground"
                )}
              >
                {hero ? t("cliPage.connectTitle") : t("cliPage.connectAnother")}
              </Heading>
              <p className="type-caption max-w-2xl text-muted-foreground">
                {t("cliPage.connectIntro")}
              </p>
            </div>
            {hero ? null : (
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost">
                  {open ? t("cliPage.hideSteps") : t("cliPage.showSteps")}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(open && "rotate-180")}
                    data-icon="inline-end"
                  />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
          <CollapsibleContent className="flex flex-col gap-8 pt-5">
            {body}
            <section
              aria-labelledby="cli-troubleshooting"
              className="flex flex-col gap-3 border-line border-t pt-5"
            >
              <h3
                className="type-body weight-semibold text-foreground"
                id="cli-troubleshooting"
              >
                {t("cliPage.troubleshooting.title")}
              </h3>
              <Troubleshooting />
            </section>
          </CollapsibleContent>
        </Collapsible>
      </PageGutter>
    </Band>
  );
}
