// The sign-in card (12 §1.1, laid out like reui's auth blocks): email → "Email me a link" → "Check your inbox"
// (resend after 60 s, change address). The link returns to `/?code=`, which
// the index route exchanges for the session cookie.

import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Mail, MailCheck } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import type { SessionState } from "@/functions/session.functions";
import { requestSignIn, setLocale } from "@/functions/session.functions";
import { useTranslation } from "@/i18n";
import { queryKeys } from "@/lib/query";

export type SignInError = "expired" | "unavailable" | "session_expired" | null;

const RESEND_SECONDS = 60;
const MARK_SIZE = 24;

/** Seconds left of a `seconds` countdown that restarts when `round` changes. */
function useCountdown(round: number, seconds: number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (round === 0) {
      setLeft(0);
      return;
    }
    setLeft(seconds);
    const timer = window.setInterval(() => {
      setLeft((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [round, seconds]);
  return left;
}

function LanguageSwitch() {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  const next = locale === "en" ? "id" : "en";
  async function switchLocale() {
    await setLocale({ data: { locale: next } });
    queryClient.setQueryData<SessionState>(queryKeys.session, (state) =>
      state ? { ...state, locale: next } : state
    );
  }
  return (
    <Button lang={next} onClick={switchLocale} size="sm" variant="ghost">
      {t("signIn.otherLanguage")}
    </Button>
  );
}

export function SignInPage({ initialError }: { initialError: SignInError }) {
  const { t } = useTranslation();
  const id = useId();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [bandError, setBandError] = useState<SignInError | "rate_limited">(
    initialError
  );
  const [sendRound, setSendRound] = useState(0);
  const left = useCountdown(sendRound, RESEND_SECONDS);

  async function send(address: string) {
    setBusy(true);
    setFieldError(null);
    setBandError(null);
    try {
      const result = await requestSignIn({ data: { email: address } });
      if (result.ok) {
        setSentTo(address);
        setSendRound((value) => value + 1);
        return;
      }
      if (result.reason === "invalid_email") {
        setFieldError(t("signIn.errors.invalidEmail"));
      } else {
        setBandError(result.reason);
      }
    } catch {
      setBandError("unavailable");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address.includes("@")) {
      setFieldError(t("signIn.errors.invalidEmail"));
      return;
    }
    send(address);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <BrandMark label={t("app.name")} />
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-16">
        <section
          aria-labelledby="sign-in-title"
          className="flex w-full max-w-sm flex-col gap-5"
        >
          <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6 sm:p-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-lg border border-border bg-background"
              >
                <img
                  alt=""
                  className="block size-6 rounded-sm"
                  height={MARK_SIZE}
                  src="/favicon/android-chrome-192x192.png"
                  width={MARK_SIZE}
                />
              </span>
              <h1 className="type-title text-foreground" id="sign-in-title">
                {t("signIn.title")}
              </h1>
              <p className="type-body text-pretty text-muted-foreground">
                {t("signIn.intro")}
              </p>
            </div>

            {bandError ? (
              <Alert role="alert" variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>{t(`signIn.errors.${bandError}Title`)}</AlertTitle>
                <AlertDescription>
                  {t(`signIn.errors.${bandError}`)}
                </AlertDescription>
              </Alert>
            ) : null}

            {sentTo ? (
              <div
                aria-live="polite"
                className="flex flex-col items-center gap-4 text-center"
              >
                <MailCheck
                  aria-hidden="true"
                  className="size-5 shrink-0 text-success"
                />
                <div className="flex flex-col gap-1">
                  <h2 className="type-subtitle text-foreground">
                    {t("signIn.checkInbox")}
                  </h2>
                  <p className="type-body text-pretty">
                    {t("signIn.sentTo", { email: sentTo })}
                  </p>
                  <p className="type-caption text-muted-foreground">
                    {t("signIn.linkLifetime")}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2">
                  <Button
                    className="w-full"
                    disabled={left > 0 || busy}
                    onClick={() => send(sentTo)}
                    variant="outline"
                  >
                    {left > 0
                      ? t("signIn.resendIn", { seconds: left })
                      : t("signIn.resend")}
                  </Button>
                  <Button
                    onClick={() => {
                      setSentTo(null);
                      setEmail(sentTo);
                    }}
                    size="sm"
                    variant="link"
                  >
                    {t("signIn.change")}
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="flex flex-col gap-4"
                noValidate
                onSubmit={submit}
              >
                <Field data-invalid={fieldError !== null}>
                  <FieldLabel htmlFor={`${id}-email`}>
                    {t("signIn.emailLabel")}
                  </FieldLabel>
                  <Input
                    aria-describedby={`${id}-email-help`}
                    aria-invalid={fieldError !== null || undefined}
                    autoComplete="email"
                    className="field-touch"
                    id={`${id}-email`}
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("signIn.emailPlaceholder")}
                    type="email"
                    value={email}
                  />
                  {fieldError ? (
                    <FieldError id={`${id}-email-help`}>
                      {fieldError}
                    </FieldError>
                  ) : (
                    <FieldDescription id={`${id}-email-help`}>
                      {t("signIn.emailHelp")}
                    </FieldDescription>
                  )}
                </Field>
                <Button
                  aria-keyshortcuts="Enter"
                  className="w-full"
                  disabled={busy}
                  type="submit"
                >
                  <Mail aria-hidden="true" data-icon="inline-start" />
                  {busy ? t("signIn.sending") : t("signIn.submit")}
                  <Kbd aria-hidden="true">↵</Kbd>
                </Button>
              </form>
            )}
          </div>
          <p className="type-caption text-pretty px-2 text-center text-muted-foreground">
            {t("signIn.footnote")}
          </p>
        </section>
      </main>
    </div>
  );
}
