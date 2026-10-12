import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@rulisme/ui/ui/attachment";
import { Avatar, AvatarFallback } from "@rulisme/ui/ui/avatar";
import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
} from "@rulisme/ui/ui/bubble";
import { Button } from "@rulisme/ui/ui/button";
import { DirectionProvider } from "@rulisme/ui/ui/direction";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@rulisme/ui/ui/input-group";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Marker, MarkerContent, MarkerIcon } from "@rulisme/ui/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@rulisme/ui/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@rulisme/ui/ui/message-scroller";
import {
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
} from "@rulisme/ui/ui/questionnaire";
import { Spinner } from "@rulisme/ui/ui/spinner";
import {
  Check,
  Circle,
  CircleAlert,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Plus,
  RotateCcw,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Block, BlockGrid, Example, Section } from "../layout";

/* ── Shared pieces ──────────────────────────────────────────────────────── */

function AssistantAvatar() {
  return (
    <MessageAvatar>
      <Avatar size="sm">
        <AvatarFallback>
          <Sparkles aria-hidden="true" className="size-3" />
        </AvatarFallback>
      </Avatar>
    </MessageAvatar>
  );
}

function ToolLine({ children }: { children: string }) {
  return (
    <Marker>
      <MarkerIcon>
        <Circle className="size-3" />
      </MarkerIcon>
      <MarkerContent>{children}</MarkerContent>
    </Marker>
  );
}

function sendOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

/* ── The thread ─────────────────────────────────────────────────────────── */

const TONES = [
  {
    value: "formal",
    label: "Formal",
    hint: "“Dear Hiring Team”, safe for any recruiter",
  },
  {
    value: "warm",
    label: "Warm",
    hint: "Personal and specific, still professional",
  },
  {
    value: "direct",
    label: "Short and direct",
    hint: "Three paragraphs, straight to the point",
  },
] as const;

const TONE_ITEMS = [
  {
    name: "tone",
    required: true,
    choices: TONES.map((tone) => ({ value: tone.value })),
  },
];

const FOLLOW_UP_REPLY =
  "Noted. I'll work from your saved CV and the Tokopedia posting, and you can apply each edit on its own.";

const REPLY_DELAY_MS = 900;

interface Turn {
  id: string;
  prompt: string;
  answered: boolean;
}

function ToneQuestion({ onAnswer }: { onAnswer: (label: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("tone");
    const tone = TONES.find((option) => option.value === value);
    if (tone) {
      onAnswer(tone.label);
    }
  }

  return (
    <Questionnaire items={TONE_ITEMS} onSubmit={submit} shortcuts="letters">
      <QuestionnaireItem name="tone" required>
        <QuestionnaireTitle>
          Which tone should the letter take?
        </QuestionnaireTitle>
        <QuestionnaireChoices>
          {TONES.map((tone) => (
            <QuestionnaireChoice key={tone.value} value={tone.value}>
              {tone.label}
              <QuestionnaireChoiceDescription>
                {tone.hint}
              </QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireSubmit>Draft the letter</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

function AssistantThread() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [applied, setApplied] = useState(true);
  const [tone, setTone] = useState<string | null>(null);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  function ask(prompt: string) {
    counter.current += 1;
    const id = `turn-${counter.current}`;
    setTurns((current) => [...current, { id, prompt, answered: false }]);
    timers.current.push(
      window.setTimeout(() => {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === id ? { ...turn, answered: true } : turn
          )
        );
      }, REPLY_DELAY_MS)
    );
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt) {
      return;
    }
    setDraft("");
    ask(prompt);
  }

  function answerTone(label: string) {
    setTone(label);
    ask(`${label}, please.`);
  }

  return (
    <div className="flex h-[34rem] flex-col overflow-hidden rounded-lg border border-border bg-pane">
      <div className="flex h-10 shrink-0 items-center gap-2 border-line border-b bg-pane-2 px-3">
        <Sparkles
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        <span className="type-caption weight-semibold shrink-0 text-foreground">
          CV assistant
        </span>
        <span className="type-caption truncate text-muted-foreground">
          cv-rina-wulandari.json
        </span>
        <span className="type-caption ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden="true"
            className="pulse-dot size-1.5 rounded-full bg-primary"
          />
          Connected
        </span>
      </div>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="CV assistant thread">
            <MessageScrollerContent className="px-4 py-5 sm:px-6">
              <MessageScrollerItem messageId="day-yesterday">
                <Marker variant="separator">
                  <MarkerContent>Yesterday</MarkerContent>
                </Marker>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="welcome">
                <Message>
                  <AssistantAvatar />
                  <MessageContent>
                    <MessageHeader>CV assistant</MessageHeader>
                    <Bubble variant="ghost">
                      <BubbleContent>
                        Your CV is saved. Attach a job posting when you're ready
                        and I'll tailor the summary to it.
                      </BubbleContent>
                    </Bubble>
                    <MessageFooter>16:20</MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="day-today">
                <Marker variant="separator">
                  <MarkerContent>Today</MarkerContent>
                </Marker>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="ask-summary" scrollAnchor>
                <Message align="end">
                  <MessageContent>
                    <AttachmentGroup className="max-w-full">
                      <Attachment size="sm">
                        <AttachmentMedia>
                          <FileText />
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>
                            tokopedia-uiux-intern-2027.pdf
                          </AttachmentTitle>
                          <AttachmentDescription>
                            PDF · 2 pages · 96 KB
                          </AttachmentDescription>
                        </AttachmentContent>
                      </Attachment>
                      <Attachment size="sm" state="error">
                        <AttachmentMedia>
                          <CircleAlert />
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>portfolio-final.pdf</AttachmentTitle>
                          <AttachmentDescription>
                            14.2 MB is over the 10 MB limit
                          </AttachmentDescription>
                        </AttachmentContent>
                      </Attachment>
                    </AttachmentGroup>
                    <Bubble align="end">
                      <BubbleContent>
                        Can you tighten my summary? It's for the UI/UX
                        internship at Tokopedia.
                      </BubbleContent>
                    </Bubble>
                    <MessageFooter>09:41</MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="tools-summary">
                <div className="flex flex-col gap-1.5">
                  <ToolLine>Read cv-rina-wulandari.json</ToolLine>
                  <ToolLine>Read tokopedia-uiux-intern-2027.pdf</ToolLine>
                  <Marker>
                    <MarkerIcon>
                      <CircleAlert />
                    </MarkerIcon>
                    <MarkerContent>
                      Skipped portfolio-final.pdf: over the 10 MB limit
                    </MarkerContent>
                  </Marker>
                </div>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="answer-summary">
                <Message>
                  <AssistantAvatar />
                  <MessageContent>
                    <MessageHeader>CV assistant</MessageHeader>
                    <BubbleGroup>
                      <Bubble variant="ghost">
                        <BubbleContent>
                          Here's a tighter summary: 41 words instead of 82. I
                          led with your Figma plugin because the posting asks
                          for prototyping, and kept the design-club role.
                        </BubbleContent>
                      </Bubble>
                      <Bubble variant="tinted">
                        <BubbleContent>
                          Informatics student at Universitas Brawijaya who ships
                          interfaces end to end: a Figma plugin used by 2,300
                          designers, three websites for small businesses in
                          Malang, and a year leading the campus design club.
                        </BubbleContent>
                      </Bubble>
                    </BubbleGroup>
                    <MessageFooter>
                      <Button
                        disabled={applied}
                        onClick={() => setApplied(true)}
                        size="xs"
                        variant="outline"
                      >
                        <Check aria-hidden="true" data-icon="inline-start" />
                        {applied ? "Applied" : "Apply to summary"}
                      </Button>
                      <Button size="xs" variant="ghost">
                        <Copy aria-hidden="true" data-icon="inline-start" />
                        Copy
                      </Button>
                    </MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              {applied ? (
                <MessageScrollerItem messageId="applied-note">
                  <Marker>
                    <MarkerIcon>
                      <Check />
                    </MarkerIcon>
                    <MarkerContent>
                      You applied the suggestion to Summary.
                    </MarkerContent>
                    <Button
                      onClick={() => setApplied(false)}
                      size="xs"
                      variant="link"
                    >
                      Undo
                    </Button>
                  </Marker>
                </MessageScrollerItem>
              ) : null}

              <MessageScrollerItem messageId="ask-language" scrollAnchor>
                <Message align="end">
                  <MessageContent>
                    <Bubble align="end">
                      <BubbleContent>
                        Thanks! Should the cover letter be in Indonesian?
                      </BubbleContent>
                    </Bubble>
                    <MessageFooter>09:44 · Read</MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="answer-language">
                <Message>
                  <AssistantAvatar />
                  <MessageContent>
                    <MessageHeader>CV assistant</MessageHeader>
                    <Bubble variant="ghost">
                      <BubbleContent>
                        The posting is in English, so write it in English. One
                        question before I draft it:
                      </BubbleContent>
                    </Bubble>
                    {tone ? (
                      <Marker>
                        <MarkerIcon>
                          <Check />
                        </MarkerIcon>
                        <MarkerContent>Tone: {tone}</MarkerContent>
                      </Marker>
                    ) : (
                      <Bubble className="w-full max-w-md" variant="outline">
                        <BubbleContent className="w-full p-4">
                          <ToneQuestion onAnswer={answerTone} />
                        </BubbleContent>
                      </Bubble>
                    )}
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              {turns.map((turn) => (
                <MessageScrollerItem
                  key={turn.id}
                  messageId={turn.id}
                  scrollAnchor
                >
                  <div className="flex flex-col gap-5">
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end">
                          <BubbleContent>{turn.prompt}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                    {turn.answered ? (
                      <Message>
                        <AssistantAvatar />
                        <MessageContent>
                          <Bubble variant="ghost">
                            <BubbleContent>{FOLLOW_UP_REPLY}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    ) : (
                      <Marker role="status">
                        <MarkerIcon>
                          <Spinner />
                        </MarkerIcon>
                        <MarkerContent>Thinking…</MarkerContent>
                      </Marker>
                    )}
                  </div>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form className="shrink-0 border-line border-t p-3" onSubmit={send}>
        <InputGroup>
          <InputGroupTextarea
            aria-label="Message the CV assistant"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={sendOnShortcut}
            placeholder="Ask about your CV…"
            rows={2}
            value={draft}
          />
          <InputGroupAddon align="block-end">
            <span className="type-caption text-muted-foreground">
              Reads this CV and what you attach
            </span>
            <InputGroupButton
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className="ms-auto"
              disabled={!draft.trim()}
              size="sm"
              type="submit"
              variant="default"
            >
              Send
              <Kbd>⌘↵</Kbd>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}

/* ── Message ────────────────────────────────────────────────────────────── */

function MessageExamples() {
  return (
    <>
      <Example
        className="bg-pane"
        label="The assistant: avatar, header, footer"
        stack
      >
        <Message>
          <AssistantAvatar />
          <MessageContent>
            <MessageHeader>CV assistant</MessageHeader>
            <Bubble variant="ghost">
              <BubbleContent>
                The posting asks for prototyping in Figma and one shipped
                project. You have both.
              </BubbleContent>
            </Bubble>
            <MessageFooter>09:42</MessageFooter>
          </MessageContent>
        </Message>
      </Example>
      <Example
        className="bg-pane"
        label="You, grouped: consecutive rows share one footer"
        stack
      >
        <MessageGroup>
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>One more thing.</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>
                  Add my Bangkit Academy certificate under Education.
                </BubbleContent>
              </Bubble>
              <MessageFooter>09:45 · Read</MessageFooter>
            </MessageContent>
          </Message>
        </MessageGroup>
      </Example>
      <Example
        className="bg-pane"
        label="Long text and unbroken links wrap"
        stack
      >
        <Message align="end">
          <MessageContent>
            <Bubble align="end">
              <BubbleContent>
                Here is the posting:
                https://www.tokopedia.com/careers/job/ui-ux-designer-intern-jakarta-2027-batch-1?ref=pilihpendidikan
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </Example>
    </>
  );
}

/* ── Bubble ─────────────────────────────────────────────────────────────── */

const BUBBLE_VARIANTS = [
  {
    variant: "default",
    sample: "Can you tighten my summary?",
    when: "What you sent: the bordered prompt on paper.",
  },
  {
    variant: "secondary",
    sample: "Draft saved to Summary.",
    when: "A neutral fill that still reads on the pane thread.",
  },
  {
    variant: "muted",
    sample: "Sari Pratiwi opened your CV.",
    when: "The pane fill, for bubbles that sit on paper.",
  },
  {
    variant: "tinted",
    sample: "Informatics student who ships interfaces end to end.",
    when: "The 7% wash: a suggestion you can apply.",
  },
  {
    variant: "outline",
    sample: "“We are looking for a UI/UX intern…”",
    when: "A hairline only, for quoted or forwarded text.",
  },
  {
    variant: "ghost",
    sample: "Here's a tighter summary, 41 words instead of 82.",
    when: "No surface: the assistant's answer as running text.",
  },
  {
    variant: "destructive",
    sample: "Couldn't read portfolio-final.pdf.",
    when: "Something failed and needs you.",
  },
] as const;

const SUGGESTIONS = [
  "Make it shorter",
  "Write it in Indonesian",
  "Mention the Figma plugin first",
] as const;

function BubbleExamples() {
  return (
    <>
      <Example label="Variants, in order of use, on paper" stack>
        {BUBBLE_VARIANTS.map((item) => (
          <div className="flex flex-col gap-1" key={item.variant}>
            <Bubble variant={item.variant}>
              <BubbleContent>{item.sample}</BubbleContent>
            </Bubble>
            <p className="type-caption text-muted-foreground">
              {item.variant} · {item.when}
            </p>
          </div>
        ))}
      </Example>
      <Example className="bg-pane" label="Suggested replies are buttons" stack>
        <BubbleGroup className="items-end">
          {SUGGESTIONS.map((suggestion) => (
            <Bubble align="end" key={suggestion} variant="tinted">
              <BubbleContent asChild>
                <button type="button">{suggestion}</button>
              </BubbleContent>
            </Bubble>
          ))}
        </BubbleGroup>
      </Example>
      <Example className="bg-pane pb-8" label="Reactions sit on the edge" stack>
        <Bubble variant="ghost">
          <BubbleContent>
            Three websites for small businesses in Malang belong in Projects,
            not Experience.
          </BubbleContent>
        </Bubble>
        <Bubble align="end">
          <BubbleContent>Moved them. Good catch.</BubbleContent>
          <BubbleReactions>
            <ThumbsUp aria-hidden="true" />
            <span>Helpful</span>
          </BubbleReactions>
        </Bubble>
      </Example>
    </>
  );
}

/* ── Attachment ─────────────────────────────────────────────────────────── */

const MANY_FILES = [
  { name: "transkrip-nilai.pdf", meta: "PDF · 312 KB" },
  { name: "sertifikat-bangkit.pdf", meta: "PDF · 1.1 MB" },
  { name: "surat-rekomendasi.pdf", meta: "PDF · 220 KB" },
  { name: "ktm-2026.jpg", meta: "JPG · 640 KB" },
  { name: "toefl-itp.pdf", meta: "PDF · 98 KB" },
  { name: "portfolio-2026.pdf", meta: "PDF · 8.4 MB" },
] as const;

function AttachmentExamples() {
  return (
    <>
      <Example label="States" stack>
        <Attachment className="w-full" state="idle">
          <AttachmentMedia>
            <Plus />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>Add a portfolio PDF</AttachmentTitle>
            <AttachmentDescription>Up to 10 MB</AttachmentDescription>
          </AttachmentContent>
          <AttachmentTrigger aria-label="Choose a PDF to attach" />
        </Attachment>
        <Attachment className="w-full" state="uploading">
          <AttachmentMedia>
            <Spinner />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>portfolio-2026.pdf</AttachmentTitle>
            <AttachmentDescription>
              Uploading · 45% of 8.4 MB
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label="Cancel upload">
              <X aria-hidden="true" />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
        <Attachment className="w-full" state="processing">
          <AttachmentMedia>
            <Spinner />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>transkrip-nilai.pdf</AttachmentTitle>
            <AttachmentDescription>
              Reading the text layer…
            </AttachmentDescription>
          </AttachmentContent>
        </Attachment>
        <Attachment className="w-full" state="error">
          <AttachmentMedia>
            <CircleAlert />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>portfolio-final.pdf</AttachmentTitle>
            <AttachmentDescription>
              14.2 MB is over the 10 MB limit
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label="Try again">
              <RotateCcw aria-hidden="true" />
            </AttachmentAction>
            <AttachmentAction aria-label="Remove file">
              <X aria-hidden="true" />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
        <Attachment className="w-full">
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>tokopedia-uiux-intern-2027.pdf</AttachmentTitle>
            <AttachmentDescription>PDF · 2 pages · 96 KB</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label="Download">
              <Download aria-hidden="true" />
            </AttachmentAction>
            <AttachmentAction aria-label="Remove file">
              <X aria-hidden="true" />
            </AttachmentAction>
          </AttachmentActions>
          <AttachmentTrigger aria-label="Open tokopedia-uiux-intern-2027.pdf" />
        </Attachment>
      </Example>
      <Example label="Sizes: default, sm, xs" stack>
        {(["default", "sm", "xs"] as const).map((size) => (
          <Attachment key={size} size={size}>
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>cv-rina-wulandari.pdf</AttachmentTitle>
              <AttachmentDescription>PDF · 184 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        ))}
      </Example>
      <Example label="Vertical; a missing image falls back to the shot tile">
        <Attachment orientation="vertical">
          <AttachmentMedia variant="image">
            <ImageIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>portfolio-cover.png</AttachmentTitle>
            <AttachmentDescription>PNG · 1.2 MB</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
        <Attachment orientation="vertical">
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>cv-rina-wulandari.pdf</AttachmentTitle>
            <AttachmentDescription>PDF · 184 KB</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label="Remove file">
              <X aria-hidden="true" />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      </Example>
      <Example label="Many files scroll in one row" stack>
        <AttachmentGroup>
          {MANY_FILES.map((file) => (
            <Attachment key={file.name} size="sm">
              <AttachmentMedia>
                <FileText />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                <AttachmentDescription>{file.meta}</AttachmentDescription>
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup>
      </Example>
    </>
  );
}

/* ── Marker ─────────────────────────────────────────────────────────────── */

function MarkerExamples() {
  return (
    <Example className="bg-pane" stack>
      <ToolLine>Read cv-rina-wulandari.json</ToolLine>
      <Marker>
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
        <MarkerContent>Reading tokopedia-uiux-intern-2027.pdf…</MarkerContent>
      </Marker>
      <Marker variant="separator">
        <MarkerContent>Today</MarkerContent>
      </Marker>
      <Marker variant="border">
        <MarkerContent>
          You shared this CV with Sari Pratiwi.{" "}
          <a href="#conversation">Manage access</a>
        </MarkerContent>
      </Marker>
      <Marker>
        <MarkerIcon>
          <CircleAlert />
        </MarkerIcon>
        <MarkerContent>
          Skipped portfolio-final.pdf because it is over the 10 MB limit.
          Compress it or link to it from your Projects section instead.
        </MarkerContent>
      </Marker>
    </Example>
  );
}

/* ── Questionnaire ──────────────────────────────────────────────────────── */

const PROJECTS = [
  { value: "plugin", label: "Figma plugin", hint: "2,300 designers use it" },
  {
    value: "websites",
    label: "Websites for Malang businesses",
    hint: "Three clients, all live",
  },
  {
    value: "club",
    label: "Campus design club",
    hint: "Led 40 members for a year",
  },
  {
    value: "bangkit",
    label: "Bangkit capstone",
    hint: "Android app, top 50 of the cohort",
  },
] as const;

const LETTER_ITEMS = [
  {
    name: "letter-tone",
    required: true,
    choices: TONES.map((tone) => ({ value: tone.value })),
  },
  {
    name: "letter-projects",
    choices: PROJECTS.map((project) => ({ value: project.value })),
  },
  { name: "letter-recipient" },
];

function LetterQuestionnaire() {
  const [summary, setSummary] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tone = TONES.find(
      (option) => option.value === data.get("letter-tone")
    );
    const projects = PROJECTS.filter((project) =>
      data.getAll("letter-projects").includes(project.value)
    ).map((project) => project.label);
    const recipient = String(data.get("letter-recipient") ?? "").trim();
    setSummary(
      [
        tone?.label,
        projects.length > 0 ? projects.join(", ") : "No projects",
        recipient || "Dear Hiring Team",
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Questionnaire
        items={LETTER_ITEMS}
        onReset={() => setSummary(null)}
        onSubmit={submit}
        shortcuts="letters"
      >
        <QuestionnaireProgress />
        <QuestionnaireItem name="letter-tone" required>
          <QuestionnaireTitle>
            Which tone should the letter take?
          </QuestionnaireTitle>
          <QuestionnaireChoices>
            {TONES.map((tone) => (
              <QuestionnaireChoice key={tone.value} value={tone.value}>
                {tone.label}
                <QuestionnaireChoiceDescription>
                  {tone.hint}
                </QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
        <QuestionnaireItem multiple name="letter-projects">
          <QuestionnaireTitle>
            Which projects should it mention?
          </QuestionnaireTitle>
          <QuestionnaireDescription>
            Pick any that fit.
          </QuestionnaireDescription>
          <QuestionnaireChoices>
            {PROJECTS.map((project) => (
              <QuestionnaireChoice key={project.value} value={project.value}>
                {project.label}
                <QuestionnaireChoiceDescription>
                  {project.hint}
                </QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
        <QuestionnaireItem name="letter-recipient">
          <QuestionnaireTitle>
            Who should the letter address?
          </QuestionnaireTitle>
          <QuestionnaireDescription>
            Leave it empty for “Dear Hiring Team”.
          </QuestionnaireDescription>
          <QuestionnaireInput autoComplete="off" placeholder="Sari Pratiwi" />
        </QuestionnaireItem>
        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireSkip />
          <QuestionnaireNext />
          <QuestionnaireSubmit>Draft the letter</QuestionnaireSubmit>
        </QuestionnaireActions>
        {summary ? (
          <Marker variant="border">
            <MarkerIcon>
              <Check />
            </MarkerIcon>
            <MarkerContent>Sent: {summary}</MarkerContent>
            <Button size="xs" type="reset" variant="link">
              Start over
            </Button>
          </Marker>
        ) : null}
      </Questionnaire>
    </div>
  );
}

/* ── Direction ──────────────────────────────────────────────────────────── */

function RightToLeftThread() {
  return (
    <DirectionProvider dir="rtl">
      <div className="flex flex-col gap-4" dir="rtl" lang="ar">
        <Marker variant="separator">
          <MarkerContent>اليوم</MarkerContent>
        </Marker>
        <Message align="end">
          <MessageContent>
            <Bubble align="end">
              <BubbleContent>
                هل يمكنك مراجعة سيرتي الذاتية قبل يوم الجمعة؟
              </BubbleContent>
            </Bubble>
            <MessageFooter>٩:٤١</MessageFooter>
          </MessageContent>
        </Message>
        <Message>
          <AssistantAvatar />
          <MessageContent>
            <MessageHeader>المساعد</MessageHeader>
            <Bubble variant="ghost">
              <BubbleContent>
                بالتأكيد. أرسل الملف وسأقترح ثلاثة تعديلات.
              </BubbleContent>
            </Bubble>
            <MessageFooter>٩:٤٢</MessageFooter>
          </MessageContent>
        </Message>
      </div>
    </DirectionProvider>
  );
}

/* ── Section ────────────────────────────────────────────────────────────── */

export function ConversationSection() {
  return (
    <Section
      id="conversation"
      lead="The agent thread on pane, the prompt on paper, subtitle-role bubbles."
      title="Conversation"
    >
      <BlockGrid>
        <Block
          description="The CV builder's assistant: one scrolling thread on pane that follows new replies, holds the turn you asked, and jumps back to the latest. Nothing animates in. Press ⌘↵ to send."
          title="Message scroller"
          wide
        >
          <AssistantThread />
        </Block>

        <Block
          description="One row: an optional framed avatar, a semibold sender, the bubbles, a muted footer. align=end is you."
          title="Message"
        >
          <MessageExamples />
        </Block>

        <Block
          description="The message surface, in the subtitle role with 2px corners, never a pill. The default is the bordered prompt on paper."
          title="Bubble"
        >
          <BubbleExamples />
        </Block>

        <Block
          description="A 2px file tile that carries its upload state. An idle slot is framed dashed; only the Blocks spinner moves."
          title="Attachment"
        >
          <AttachmentExamples />
        </Block>

        <Block
          description="Tool lines, system notes and day dividers in the caption role, ruled by line hairlines."
          title="Marker"
        >
          <MarkerExamples />
        </Block>

        <Block
          description="A short multiple-choice prompt the assistant asks inside the thread. Letters answer it from the keyboard; ⌘↵ moves on."
          title="Questionnaire"
        >
          <Example stack>
            <LetterQuestionnaire />
          </Example>
        </Block>

        <Block
          description="Right-to-left threads mirror inside DirectionProvider; set dir=rtl on the wrapper too."
          title="Direction"
        >
          <Example className="bg-pane" label="Arabic, right to left" stack>
            <RightToLeftThread />
          </Example>
        </Block>
      </BlockGrid>
    </Section>
  );
}
