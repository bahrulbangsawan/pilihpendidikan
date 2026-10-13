// The sign-in band (12 §1.1): email → "Email me a link" → "Check your inbox"
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
import { Band, Rail } from "@rulisme/ui/ui/rails";
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
const GUTTER = "px-5 sm:px-10";

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
      <header className="band">
        <Rail
          className={`flex h-14 items-center justify-between ${GUTTER}`}
          nodes={false}
        >
          <BrandMark label={t("app.name")} />
          <LanguageSwitch />
        </Rail>
      </header>
      <main className="flex flex-1 flex-col">
        <Band asChild className="graph-paper flex flex-1 flex-col">
          <section aria-labelledby="sign-in-title">
            <Rail
              className={`${GUTTER} flex flex-1 flex-col items-start gap-8 pt-20 pb-16 sm:pt-28`}
            >
              <div className="flex max-w-xl flex-col gap-3">
                <h1
                  className="type-display text-primary italic"
                  id="sign-in-title"
                >
                  {t("signIn.title")}
                </h1>
                <p className="type-subtitle text-pretty">{t("signIn.intro")}</p>
              </div>

              {bandError ? (
                <Alert className="max-w-md" role="alert" variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>
                    {t(`signIn.errors.${bandError}Title`)}
                  </AlertTitle>
                  <AlertDescription>
                    {t(`signIn.errors.${bandError}`)}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="w-full max-w-md border border-border bg-card p-5 sm:p-6">
                {sentTo ? (
                  <div aria-live="polite" className="flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                      <MailCheck
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-foreground"
                      />
                      <div className="flex flex-col gap-1">
                        <h2 className="type-title">{t("signIn.checkInbox")}</h2>
                        <p className="type-body text-pretty">
                          {t("signIn.sentTo", { email: sentTo })}
                        </p>
                        <p className="type-caption text-muted-foreground">
                          {t("signIn.linkLifetime")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        disabled={left > 0 || busy}
                        onClick={() => send(sentTo)}
                        size="sm"
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
                      className="self-start"
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
            </Rail>
          </section>
        </Band>
        <Band>
          <Rail className={`${GUTTER} py-6`}>
            <p className="type-caption max-w-2xl text-pretty text-muted-foreground">
              {t("signIn.footnote")}
            </p>
          </Rail>
        </Band>
      </main>
    </div>
  );
}
