"use client";

import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire";
import { CheckIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

import type { Button } from "./button";
import { buttonVariants } from "./button-variants";
import { Kbd } from "./kbd";

// A short multiple-choice prompt inside a thread, like Cursor's agent
// questions. The question takes the subtitle role at weight 400; each choice
// is an 8px card (`bg-card`, 10% border, `pane` hover, `pane-2` once chosen)
// with a 4px check or a round radio that fills with the ink pill colour
// (`primary`) when chosen, and a <Kbd> chip for its letter shortcut.
// Progress is a muted caption with tabular figures. Nothing animates between
// questions.

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      className={cn("flex w-full min-w-0 flex-col gap-4", className)}
      data-slot="questionnaire"
      {...props}
    />
  );
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      className={cn(
        "type-caption min-h-[1lh] w-fit min-w-[14ch] text-muted-foreground tabular-nums",
        className
      )}
      data-slot="questionnaire-progress"
      {...props}
    />
  );
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      className={cn(
        "flex min-w-0 flex-col gap-3 border-0 p-0 outline-none",
        className
      )}
      data-slot="questionnaire-item"
      {...props}
    />
  );
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      className={cn(
        "type-subtitle text-pretty text-foreground [&:not(:has(~[data-slot=questionnaire-description]))]:mb-3",
        className
      )}
      data-slot="questionnaire-title"
      {...props}
    />
  );
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      className={cn(
        "type-caption mt-1 text-pretty text-muted-foreground",
        className
      )}
      data-slot="questionnaire-description"
      {...props}
    />
  );
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      className={cn(
        "group/questionnaire-choices grid min-w-0 gap-2",
        className
      )}
      data-slot="questionnaire-choices"
      {...props}
    />
  );
}

function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      className={cn(
        "group/questionnaire-choice type-body relative flex min-h-11 cursor-pointer select-none items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-start text-foreground transition-[background-color,border-color] duration-140 ease-standard has-[>input:focus-visible]:outline-2 has-[>input:focus-visible]:outline-ring has-[>input:focus-visible]:outline-solid has-[>input:focus-visible]:outline-offset-0 data-checked:border-input data-invalid:border-destructive data-checked:bg-pane-2 data-[unchecked]:hover:bg-pane",
        "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      data-slot="questionnaire-choice"
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
        data-slot="questionnaire-choice-input"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background text-primary-foreground group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary"
        data-slot="questionnaire-choice-indicator"
      >
        <span
          className="hidden size-1.5 rounded-full bg-primary-foreground group-data-checked/questionnaire-choice:block group-data-[type=checkbox]/questionnaire-choice:hidden"
          data-slot="questionnaire-choice-indicator-dot"
        />
        <CheckIcon
          className="hidden size-3 group-data-checked/questionnaire-choice:block group-data-[type=radio]/questionnaire-choice:hidden"
          data-slot="questionnaire-choice-indicator-check"
        />
      </span>
      <QuestionnairePrimitive.ChoiceLabel
        className="flex min-w-0 flex-1 flex-col"
        data-slot="questionnaire-choice-label"
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      <QuestionnairePrimitive.ChoiceShortcut
        className="ms-auto shrink-0"
        data-slot="questionnaire-choice-shortcut"
        render={<Kbd />}
      />
    </QuestionnairePrimitive.Choice>
  );
}

function QuestionnaireChoiceDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "type-caption weight-normal text-muted-foreground",
        className
      )}
      data-slot="questionnaire-choice-description"
      {...props}
    />
  );
}

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <div
      className="group/questionnaire-input relative w-full min-w-0"
      data-slot="questionnaire-input-wrapper"
    >
      <QuestionnairePrimitive.Input
        className={cn(
          "type-body field-touch h-9 min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-foreground outline-none transition-[background-color,border-color] duration-140 ease-standard selection:bg-highlight placeholder:text-muted-foreground hover:border-input focus-visible:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-pane disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive sm:min-h-0",
          className
        )}
        data-slot="questionnaire-input"
        {...props}
      />
    </div>
  );
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      className={cn("type-caption text-destructive", className)}
      data-slot="questionnaire-error"
      {...props}
    />
  );
}

function QuestionnaireActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:min-h-9",
        className
      )}
      data-slot="questionnaire-actions"
      {...props}
    />
  );
}

function QuestionnairePrevious({
  children,
  className,
  size = "default",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Previous
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-1 row-start-1 min-h-11 justify-self-start sm:min-h-0",
        className
      )}
      data-size={size}
      data-slot="questionnaire-previous"
      data-variant={variant}
      {...props}
    >
      {children ?? "Previous"}
    </QuestionnairePrimitive.Previous>
  );
}

function QuestionnaireSkip({
  children,
  className,
  size = "default",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Skip
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-2 row-start-1 min-h-11 justify-self-end sm:min-h-0",
        className
      )}
      data-size={size}
      data-slot="questionnaire-skip"
      data-variant={variant}
      {...props}
    >
      {children ?? "Skip"}
    </QuestionnairePrimitive.Skip>
  );
}

function QuestionnaireNext({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Next
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0",
        className
      )}
      data-size={size}
      data-slot="questionnaire-next"
      data-variant={variant}
      {...props}
    >
      {children ?? "Next"}
    </QuestionnairePrimitive.Next>
  );
}

function QuestionnaireSubmit({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Submit
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0",
        className
      )}
      data-size={size}
      data-slot="questionnaire-submit"
      data-variant={variant}
      {...props}
    >
      {children ?? "Submit"}
    </QuestionnairePrimitive.Submit>
  );
}

export {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
};
