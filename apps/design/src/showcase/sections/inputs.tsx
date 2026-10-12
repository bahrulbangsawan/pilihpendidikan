import { FormField, FormFieldCustom } from "@rulisme/ui/form/form-field";
import { MonthPicker } from "@rulisme/ui/form/month-picker";
import { PhoneInput } from "@rulisme/ui/reui/phone-input";
import { Button } from "@rulisme/ui/ui/button";
import { Calendar } from "@rulisme/ui/ui/calendar";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxValue,
  useComboboxAnchor,
} from "@rulisme/ui/ui/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@rulisme/ui/ui/input-group";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@rulisme/ui/ui/input-otp";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Label } from "@rulisme/ui/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@rulisme/ui/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@rulisme/ui/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Slider } from "@rulisme/ui/ui/slider";
import { Switch } from "@rulisme/ui/ui/switch";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@rulisme/ui/ui/toggle-group";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  AtSign,
  Copy,
  FileJson,
  FileText,
  Link2,
  Mail,
  Search,
} from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Block, BlockGrid, Example, Section } from "../layout";
import { previewState, StateMatrix } from "../state-matrix";
import { useScheme } from "../theme";

const FIELD_STATES = ["default", "hover", "focus", "disabled", "invalid"];

const PROVINCES = [
  "Aceh",
  "Sumatera Utara",
  "Sumatera Barat",
  "Riau",
  "Kepulauan Riau",
  "Jambi",
  "Sumatera Selatan",
  "Kepulauan Bangka Belitung",
  "Bengkulu",
  "Lampung",
  "DKI Jakarta",
  "Jawa Barat",
  "Banten",
  "Jawa Tengah",
  "DI Yogyakarta",
  "Jawa Timur",
  "Bali",
  "Nusa Tenggara Barat",
  "Nusa Tenggara Timur",
  "Kalimantan Barat",
  "Kalimantan Tengah",
  "Kalimantan Selatan",
  "Kalimantan Timur",
  "Kalimantan Utara",
  "Sulawesi Utara",
  "Gorontalo",
  "Sulawesi Tengah",
  "Sulawesi Barat",
  "Sulawesi Selatan",
  "Sulawesi Tenggara",
  "Maluku",
  "Maluku Utara",
  "Papua",
  "Papua Barat",
  "Papua Barat Daya",
  "Papua Tengah",
  "Papua Pegunungan",
  "Papua Selatan",
];

const UNIVERSITIES = [
  {
    value: "Malang",
    items: ["Universitas Brawijaya", "Universitas Negeri Malang"],
  },
  {
    value: "Bandung",
    items: ["Institut Teknologi Bandung", "Universitas Padjadjaran"],
  },
  {
    value: "Yogyakarta",
    items: ["Universitas Gadjah Mada", "Universitas Negeri Yogyakarta"],
  },
  {
    value: "Surabaya",
    items: ["Institut Teknologi Sepuluh Nopember", "Universitas Airlangga"],
  },
];

const SKILLS = [
  "React",
  "TypeScript",
  "Swift",
  "SwiftUI",
  "Figma",
  "Python",
  "SQL",
  "Public speaking",
  "Copywriting",
  "Data analysis",
];

const GRADUATION_YEARS = [2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020];

const CHECKBOX_STATE = {
  unchecked: false,
  checked: true,
  indeterminate: "indeterminate",
} as const;

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** `aria-invalid` for the matrix column that pins the invalid state. */
function invalid(state: string): true | undefined {
  return state === "invalid" ? true : undefined;
}

function FieldBlock() {
  const { scheme, setScheme } = useScheme();
  return (
    <Block
      description="A label, a control, a description and an error, stacked 8px apart. FieldGroup spaces fields; FieldSet and FieldLegend group related ones. An invalid Field turns its label destructive while the control carries aria-invalid."
      title="Field"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Example label="Typical: personal details, one required" paper stack>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="field-name">
                Full name
                <span aria-hidden="true" className="-ml-1 text-destructive">
                  *
                </span>
              </FieldLabel>
              <Input
                autoComplete="name"
                defaultValue="Rina Wulandari"
                id="field-name"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-headline">Headline</FieldLabel>
              <Input
                id="field-headline"
                placeholder="Informatics graduate, Universitas Brawijaya"
              />
              <FieldDescription>
                One line under your name. Recruiters read it first.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </Example>

        <Example label="Error, and several errors" stack>
          <FieldGroup>
            <Field data-invalid>
              <FieldLabel htmlFor="field-email">Email</FieldLabel>
              <Input
                aria-describedby="field-email-error"
                aria-invalid
                defaultValue="rina.wulandari@"
                id="field-email"
                type="email"
              />
              <FieldError id="field-email-error">
                Enter a full address, like rina@ub.ac.id.
              </FieldError>
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="field-password">Password</FieldLabel>
              <Input
                aria-describedby="field-password-error"
                aria-invalid
                defaultValue="rina"
                id="field-password"
                type="password"
              />
              <FieldError
                errors={[
                  { message: "Use at least 8 characters." },
                  { message: "Add a number or a symbol." },
                ]}
                id="field-password-error"
              />
            </Field>
          </FieldGroup>
        </Example>

        <Example label="FieldSet with a legend" stack>
          <FieldSet>
            <FieldLegend>Billing address</FieldLegend>
            <FieldDescription>
              Printed under your name on every invoice.
            </FieldDescription>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="field-street">Street</FieldLabel>
                <Input defaultValue="Jl. Veteran No. 10" id="field-street" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="field-city">City</FieldLabel>
                  <Input defaultValue="Malang" id="field-city" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="field-postal">Postal code</FieldLabel>
                  <Input
                    defaultValue="65145"
                    id="field-postal"
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>
        </Example>

        <div className="flex min-w-0 flex-col gap-4">
          <Example label="Disabled" stack>
            <Field data-disabled>
              <FieldLabel htmlFor="field-slug">Public link</FieldLabel>
              <Input
                defaultValue="cv.pilihpendidikan.com/rina-wulandari"
                disabled
                id="field-slug"
              />
              <FieldDescription>
                Sign in to choose your own link.
              </FieldDescription>
            </Field>
          </Example>
          <Example label="Horizontal rows and a FieldTitle" stack>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="field-public">Public CV link</FieldLabel>
                  <FieldDescription>
                    Anyone with the link reads your latest saved version.
                  </FieldDescription>
                </FieldContent>
                <Switch defaultChecked id="field-public" />
              </Field>
              <FieldSeparator />
              <Field orientation="horizontal">
                <FieldTitle id="field-theme-label">Theme</FieldTitle>
                {/* Drives the page scheme, so it never contradicts it. */}
                <ToggleGroup
                  aria-labelledby="field-theme-label"
                  onValueChange={(value) => {
                    if (value === "light" || value === "dark") {
                      setScheme(value);
                    }
                  }}
                  size="sm"
                  type="single"
                  value={scheme}
                >
                  <ToggleGroupItem value="light">Light</ToggleGroupItem>
                  <ToggleGroupItem value="dark">Night Desk</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </Example>
        </div>

        <Example label="A separator with a word" stack>
          <FieldGroup>
            <Button variant="outline">Import from LinkedIn</Button>
            <FieldSeparator>or</FieldSeparator>
            <Field>
              <FieldLabel htmlFor="field-upload">
                Start from an existing CV
              </FieldLabel>
              <Input accept=".pdf,.json" id="field-upload" type="file" />
              <FieldDescription>
                A PDF or JSON exported from pilihpendidikan, up to 2 MB.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </Example>

        <Example
          label="Responsive: side by side from the field group's md width"
          stack
        >
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="field-ipk">GPA (IPK)</FieldLabel>
                <FieldDescription>On a 4.00 scale.</FieldDescription>
              </FieldContent>
              <Input
                className="tabular-nums md:max-w-32"
                defaultValue="3.85"
                id="field-ipk"
                inputMode="decimal"
              />
            </Field>
          </FieldGroup>
        </Example>
      </div>
    </Block>
  );
}

function LabelBlock() {
  return (
    <Block
      description="Names a control in the body role and the foreground colour of the control itself. It dims with a disabled peer."
      title="Label"
    >
      <Example label="Typical, beside a checkbox, disabled" paper stack>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label-university">University</Label>
          <Input defaultValue="Universitas Brawijaya" id="label-university" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox defaultChecked id="label-phone" />
          <Label htmlFor="label-phone">Show my phone number on the CV</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox disabled id="label-photo" />
          <Label htmlFor="label-photo">Hide my photo on shared links</Label>
        </div>
      </Example>
    </Block>
  );
}

function InputGroupBlock() {
  return (
    <Block
      description="Addons inside the field shell: icons, prefixes and units, kbd hints and small buttons. Focus and errors light the whole shell."
      title="InputGroup"
    >
      <Example label="Icons, text and kbd" paper stack>
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search templates"
            placeholder="Search templates"
          />
          <InputGroupAddon align="inline-end">
            <Kbd>⌘K</Kbd>
          </InputGroupAddon>
        </InputGroup>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>Rp</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Monthly fee"
            className="tabular-nums"
            defaultValue="2.500.000"
            inputMode="numeric"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>per month</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>linkedin.com/in/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            aria-label="LinkedIn handle"
            defaultValue="rina-wulandari"
          />
        </InputGroup>
      </Example>
      <Example label="Buttons inside" stack>
        <InputGroup>
          <InputGroupAddon>
            <Link2 aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Share link"
            readOnly
            value="cv.pilihpendidikan.com/rina-wulandari"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton aria-label="Copy link" size="icon-xs">
              <Copy aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <InputGroup>
          <InputGroupAddon>
            <AtSign aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput aria-label="Username" defaultValue="rinawulandari" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton variant="secondary">Check</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Example>
      <Example label="Textarea with a footer" stack>
        <InputGroup>
          <InputGroupTextarea
            aria-label="Message to the assistant"
            placeholder="Ask the assistant to tighten your summary"
          />
          <InputGroupAddon align="block-end" className="border-t">
            <InputGroupText className="type-caption tabular-nums">
              0 / 280
            </InputGroupText>
            <InputGroupButton className="ml-auto" size="sm" variant="default">
              Send
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Example>
      <Example label="Invalid and disabled" stack>
        <InputGroup>
          <InputGroupAddon>
            <Mail aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-invalid
            aria-label="Email"
            defaultValue="rina@"
          />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon>
            <Mail aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Recovery email"
            disabled
            placeholder="Available after you verify your email"
          />
        </InputGroup>
      </Example>
    </Block>
  );
}

function InputBlock() {
  return (
    <Block
      description="A single-line field: 36px like the buttons beside it, a line outline on half-transparent paper, the body role (16px on touch screens). Focus turns the outline cobalt with a soft halo; there is no hover change."
      title="Input"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Example label="Typical" paper stack>
          <Field>
            <FieldLabel htmlFor="input-email">Email</FieldLabel>
            <Input
              autoComplete="email"
              id="input-email"
              placeholder="you@universitas.ac.id"
              type="email"
            />
          </Field>
        </Example>
        <Example
          label="Types: password, number, file, read-only, long value"
          stack
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              aria-label="Password"
              defaultValue="pilihpendidikan"
              type="password"
            />
            <Input
              aria-label="GPA"
              className="tabular-nums"
              defaultValue="3.85"
              max={4}
              min={0}
              step={0.01}
              type="number"
            />
            <Input accept=".pdf" aria-label="Transcript" type="file" />
            <Input aria-label="CV id" readOnly value="cv_8f3k2m" />
          </div>
          <Input
            aria-label="Portfolio URL"
            defaultValue="https://portfolio.pilihpendidikan.com/rina-wulandari/apple-developer-academy-2026"
          />
        </Example>
      </div>
      <StateMatrix
        render={(row, state) => (
          <Input
            aria-invalid={invalid(state)}
            aria-label="Email"
            className="w-44"
            defaultValue={row === "filled" ? "rina@ub.ac.id" : undefined}
            placeholder="you@universitas.ac.id"
            {...previewState(state)}
          />
        )}
        rows={["placeholder", "filled"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function TextareaBlock() {
  return (
    <Block
      description="Multi-line text in the field shell. It grows with its content from two lines and never shows a resize grip."
      title="Textarea"
      wide
    >
      <Example label="Typical: a professional summary" paper stack>
        <Field>
          <FieldLabel htmlFor="textarea-summary">
            Professional summary
          </FieldLabel>
          <Textarea
            defaultValue="Informatics graduate from Universitas Brawijaya who builds accessible web apps. Led a team of four at the Apple Developer Academy to ship a budgeting app for students."
            id="textarea-summary"
          />
          <FieldDescription>
            Two or three sentences. Lead with what you build.
          </FieldDescription>
        </Field>
      </Example>
      <StateMatrix
        render={(row, state) => (
          <Textarea
            aria-invalid={invalid(state)}
            aria-label="Summary"
            className="w-44"
            defaultValue={
              row === "filled"
                ? "Builds accessible web apps for students."
                : undefined
            }
            placeholder="What do you do best?"
            {...previewState(state)}
          />
        )}
        rows={["placeholder", "filled"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function DegreeOptions() {
  return (
    <>
      <SelectGroup>
        <SelectLabel>Undergraduate</SelectLabel>
        <SelectItem value="d3">Diploma (D3)</SelectItem>
        <SelectItem value="d4">Applied bachelor (D4)</SelectItem>
        <SelectItem value="s1">Bachelor (S1)</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel>Graduate</SelectLabel>
        <SelectItem value="s2">Master (S2)</SelectItem>
        <SelectItem value="s3">Doctorate (S3)</SelectItem>
      </SelectGroup>
    </>
  );
}

function SelectBlock() {
  return (
    <Block
      description="A short fixed list behind the field shell. The menu opens in a window (6px, hairline border, float shadow) with 2px rows; the chosen row goes semibold with a check. It opens and closes instantly."
      title="Select"
      wide
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Example label="Typical: degree, grouped" paper stack>
          <Field>
            <FieldLabel htmlFor="select-degree">Degree</FieldLabel>
            <Select defaultValue="s1">
              <SelectTrigger className="w-full" id="select-degree">
                <SelectValue placeholder="Choose a degree" />
              </SelectTrigger>
              <SelectContent>
                <DegreeOptions />
              </SelectContent>
            </Select>
          </Field>
        </Example>
        <Example label="Sizes, icons, a disabled option" stack>
          <Select defaultValue="pdf">
            <SelectTrigger aria-label="Export format" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="pdf">
                  <FileText aria-hidden="true" />
                  PDF document
                </SelectItem>
                <SelectItem value="json">
                  <FileJson aria-hidden="true" />
                  JSON backup
                </SelectItem>
                <SelectItem disabled value="docx">
                  <FileText aria-hidden="true" />
                  Word document
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select defaultValue="pdf">
            <SelectTrigger aria-label="Export format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="pdf">
                  <FileText aria-hidden="true" />
                  PDF document
                </SelectItem>
                <SelectItem value="json">
                  <FileJson aria-hidden="true" />
                  JSON backup
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Example>
        <Example label="Many options, long value, popper" stack>
          <Select defaultValue="Kepulauan Bangka Belitung">
            <SelectTrigger aria-label="Province" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {PROVINCES.map((province) => (
                  <SelectItem key={province} value={province}>
                    {province}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="type-caption text-muted-foreground">
            38 provinces: the window scrolls inside the viewport.
          </p>
        </Example>
      </div>
      <StateMatrix
        render={(row, state) => (
          <Select defaultValue={row === "value" ? "s1" : undefined}>
            <SelectTrigger
              aria-invalid={invalid(state)}
              aria-label="Degree"
              className="w-44"
              {...previewState(state)}
            >
              <SelectValue placeholder="Choose a degree" />
            </SelectTrigger>
            <SelectContent>
              <DegreeOptions />
            </SelectContent>
          </Select>
        )}
        rows={["placeholder", "value"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function NativeSelectBlock() {
  return (
    <Block
      description="The browser's own menu behind the field shell, with a muted chevron. No JavaScript: long fixed lists and forms that must work before hydration."
      title="NativeSelect"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Example label="Typical, small, with option groups" paper>
          <Field className="w-auto">
            <FieldLabel htmlFor="native-year">Graduation year</FieldLabel>
            <NativeSelect defaultValue="2026" id="native-year">
              {GRADUATION_YEARS.map((year) => (
                <NativeSelectOption key={year} value={year}>
                  {year}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="native-degree">Degree</FieldLabel>
            <NativeSelect defaultValue="s1" id="native-degree" size="sm">
              <NativeSelectOptGroup label="Undergraduate">
                <NativeSelectOption value="d3">Diploma (D3)</NativeSelectOption>
                <NativeSelectOption value="s1">
                  Bachelor (S1)
                </NativeSelectOption>
              </NativeSelectOptGroup>
              <NativeSelectOptGroup label="Graduate">
                <NativeSelectOption value="s2">Master (S2)</NativeSelectOption>
                <NativeSelectOption value="s3">
                  Doctorate (S3)
                </NativeSelectOption>
              </NativeSelectOptGroup>
            </NativeSelect>
          </Field>
        </Example>
        <Example label="Full width, long option" stack>
          <NativeSelect
            aria-label="Province"
            className="w-full"
            defaultValue="Kepulauan Bangka Belitung"
          >
            {PROVINCES.map((province) => (
              <NativeSelectOption key={province} value={province}>
                {province}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Example>
      </div>
      <StateMatrix
        render={(_, state) => (
          <NativeSelect
            aria-invalid={invalid(state)}
            aria-label="Graduation year"
            className="w-36"
            defaultValue="2026"
            {...previewState(state)}
          >
            {GRADUATION_YEARS.map((year) => (
              <NativeSelectOption key={year} value={year}>
                {year}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        rows={["native"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function SkillsCombobox() {
  const anchor = useComboboxAnchor();
  return (
    <Combobox defaultValue={["React", "Figma"]} items={SKILLS} multiple>
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((value) => (
                <ComboboxChip key={value}>{value}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                aria-label="Skills"
                placeholder="Add a skill"
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No skills match. Press Enter to add it.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function ProvinceCombobox({
  id,
  defaultValue,
  showClear = false,
  disabled = false,
  invalidInput = false,
  placeholder = "Search a province",
}: {
  id: string;
  defaultValue?: string;
  showClear?: boolean;
  disabled?: boolean;
  invalidInput?: boolean;
  placeholder?: string;
}) {
  return (
    <Combobox defaultValue={defaultValue ?? null} items={PROVINCES}>
      <ComboboxInput
        aria-invalid={invalidInput || undefined}
        className="w-full"
        disabled={disabled}
        id={id}
        placeholder={placeholder}
        showClear={showClear}
      />
      <ComboboxContent>
        <ComboboxEmpty>No province matches. Check the spelling.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function ComboboxBlock() {
  return (
    <Block
      description="A searchable select for long lists: provinces, universities, countries. Type to filter; an empty search says so in the list."
      title="Combobox"
    >
      <Example
        label="Typical: province (type “Atlantis” for no matches)"
        paper
        stack
      >
        <Field>
          <FieldLabel htmlFor="combobox-province">Province</FieldLabel>
          <ProvinceCombobox id="combobox-province" />
        </Field>
      </Example>
      <Example label="With a clear button, grouped, multiple" stack>
        <ProvinceCombobox
          defaultValue="Jawa Timur"
          id="combobox-province-clear"
          showClear
        />
        <Combobox items={UNIVERSITIES}>
          <ComboboxInput
            aria-label="University"
            className="w-full"
            placeholder="Search a university"
          />
          <ComboboxContent>
            <ComboboxEmpty>No university matches.</ComboboxEmpty>
            <ComboboxList>
              {(group: (typeof UNIVERSITIES)[number], index: number) => (
                <ComboboxGroup items={group.items} key={group.value}>
                  {index > 0 ? <ComboboxSeparator /> : null}
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(item: string) => (
                      <ComboboxItem key={item} value={item}>
                        {item}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <SkillsCombobox />
      </Example>
      <Example label="Invalid and disabled" stack>
        <ProvinceCombobox
          defaultValue="Jawa"
          id="combobox-invalid"
          invalidInput
        />
        <ProvinceCombobox
          disabled
          id="combobox-disabled"
          placeholder="Choose a country first"
        />
      </Example>
    </Block>
  );
}

function CheckboxBlock() {
  return (
    <Block
      description="A 16px square with a 2px radius. Checked or mixed, it fills cobalt with a white tick or dash."
      title="Checkbox"
    >
      <Example label="Typical: sections to include" paper stack>
        <FieldSet>
          <FieldLegend variant="label">Sections to include</FieldLegend>
          <FieldGroup className="gap-3" data-slot="checkbox-group">
            <Field orientation="horizontal">
              <Checkbox defaultChecked id="check-experience" />
              <FieldLabel htmlFor="check-experience">
                Work experience
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox defaultChecked id="check-education" />
              <FieldLabel htmlFor="check-education">Education</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="check-projects" />
              <FieldContent>
                <FieldLabel htmlFor="check-projects">Projects</FieldLabel>
                <FieldDescription>
                  Recommended for Apple Developer Academy applicants.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </FieldSet>
      </Example>
      <StateMatrix
        render={(row, state) => (
          <Checkbox
            aria-invalid={invalid(state)}
            aria-label="Include projects"
            checked={CHECKBOX_STATE[row]}
            {...previewState(state)}
          />
        )}
        rows={["unchecked", "checked", "indeterminate"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function RadioGroupBlock() {
  return (
    <Block
      description="Pick one of a few. The one round control: a 16px ring that turns cobalt around a cobalt dot. Wrap a whole Field in a FieldLabel for a choice card."
      title="RadioGroup"
    >
      <Example label="Typical: inside a FieldSet" paper stack>
        <FieldSet>
          <FieldLegend variant="label">Paper size</FieldLegend>
          <RadioGroup defaultValue="a4">
            <Field orientation="horizontal">
              <RadioGroupItem id="radio-a4" value="a4" />
              <FieldLabel htmlFor="radio-a4">A4 (Indonesia, Europe)</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem id="radio-letter" value="letter" />
              <FieldLabel htmlFor="radio-letter">
                Letter (United States)
              </FieldLabel>
            </Field>
          </RadioGroup>
        </FieldSet>
      </Example>
      <Example label="Choice cards" stack>
        <RadioGroup aria-label="CV template" defaultValue="modern">
          <FieldLabel htmlFor="radio-classic">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Classic</FieldTitle>
                <FieldDescription>
                  One column, generous margins.
                </FieldDescription>
              </FieldContent>
              <RadioGroupItem id="radio-classic" value="classic" />
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor="radio-modern">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Modern</FieldTitle>
                <FieldDescription>
                  A side rail for skills and contacts.
                </FieldDescription>
              </FieldContent>
              <RadioGroupItem id="radio-modern" value="modern" />
            </Field>
          </FieldLabel>
        </RadioGroup>
      </Example>
      <StateMatrix
        render={(row, state) => (
          <RadioGroup
            aria-label="Paper size"
            value={row === "selected" ? "a4" : ""}
          >
            <RadioGroupItem
              aria-invalid={invalid(state)}
              aria-label="A4"
              value="a4"
              {...previewState(state)}
            />
          </RadioGroup>
        )}
        rows={["unselected", "selected"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function SwitchBlock() {
  return (
    <Block
      description="An instant on/off setting. Boxy, not a pill: a 2px track with a 2px square thumb; on, the track fills cobalt. The thumb jumps, it does not slide."
      title="Switch"
    >
      <Example label="Typical: sharing settings" paper stack>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="switch-public">Public CV link</FieldLabel>
              <FieldDescription>
                Anyone with the link can read it.
              </FieldDescription>
            </FieldContent>
            <Switch defaultChecked id="switch-public" />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="switch-views">
                Email me when it is viewed
              </FieldLabel>
              <FieldDescription>At most one email a day.</FieldDescription>
            </FieldContent>
            <Switch id="switch-views" />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="switch-compact">Compact layout</FieldLabel>
            <Switch id="switch-compact" size="sm" />
          </Field>
        </FieldGroup>
      </Example>
      <StateMatrix
        render={(row, state) => (
          <Switch
            aria-invalid={invalid(state)}
            aria-label="Public CV link"
            checked={row === "on"}
            {...previewState(state)}
          />
        )}
        rows={["off", "on"] as const}
        states={FIELD_STATES}
      />
    </Block>
  );
}

function SliderBlock() {
  const [photo, setPhoto] = useState([60]);
  const [salary, setSalary] = useState([5_000_000, 12_000_000]);
  return (
    <Block
      description="A value on a scale: a thin pane-2 track, a cobalt range and a small square chip for each thumb."
      title="Slider"
    >
      <Example label="Typical: photo size" paper stack>
        <div className="flex items-center justify-between gap-4">
          <span className="type-body text-foreground" id="slider-photo-label">
            Photo size
          </span>
          <span className="type-caption text-muted-foreground tabular-nums">
            {photo[0]}%
          </span>
        </div>
        <Slider
          aria-labelledby="slider-photo-label"
          max={100}
          min={20}
          onValueChange={setPhoto}
          step={5}
          value={photo}
        />
      </Example>
      <Example label="Range, disabled, vertical" stack>
        <div className="flex items-center justify-between gap-4">
          <span className="type-body text-foreground">Expected salary</span>
          <span className="type-caption text-muted-foreground tabular-nums">
            {RUPIAH.format(salary[0] ?? 0)} – {RUPIAH.format(salary[1] ?? 0)}
          </span>
        </div>
        <Slider
          aria-label="Expected salary"
          max={25_000_000}
          min={0}
          minStepsBetweenThumbs={1}
          onValueChange={setSalary}
          step={500_000}
          value={salary}
        />
        <div className="mt-2 flex items-center justify-between gap-4">
          <span className="type-body text-foreground">
            Page margin (Pro templates)
          </span>
          <span className="type-caption text-muted-foreground tabular-nums">
            40%
          </span>
        </div>
        <Slider aria-label="Page margin" defaultValue={[40]} disabled />
        <span className="type-body mt-2 text-foreground">
          Line and paragraph spacing
        </span>
        <div className="flex h-40 items-stretch gap-6">
          <Slider
            aria-label="Line spacing"
            defaultValue={[50]}
            orientation="vertical"
          />
          <Slider
            aria-label="Paragraph spacing"
            defaultValue={[20, 70]}
            orientation="vertical"
          />
        </div>
      </Example>
    </Block>
  );
}

function InputOTPBlock() {
  const [code, setCode] = useState("482");
  const [expired, setExpired] = useState("913027");
  return (
    <Block
      description="A short code in 36px slots joined by hairlines. The active slot lifts with the field focus and a caret."
      title="InputOTP"
    >
      <Example label="Typical: email sign-in" paper stack>
        <Field>
          <FieldLabel htmlFor="otp-signin">Verification code</FieldLabel>
          <InputOTP
            id="otp-signin"
            maxLength={6}
            onChange={setCode}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <FieldDescription>
            We sent it to rina@ub.ac.id. It expires in 10 minutes.
          </FieldDescription>
        </Field>
      </Example>
      <Example label="Invalid and disabled" stack>
        <Field data-invalid>
          <FieldLabel htmlFor="otp-expired">Verification code</FieldLabel>
          <InputOTP
            id="otp-expired"
            maxLength={6}
            onChange={setExpired}
            value={expired}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((slot) => (
                <InputOTPSlot aria-invalid index={slot} key={slot} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <FieldError>That code has expired. Request a new one.</FieldError>
        </Field>
        <InputOTP aria-label="PIN" disabled maxLength={4}>
          <InputOTPGroup>
            {[0, 1, 2, 3].map((slot) => (
              <InputOTPSlot index={slot} key={slot} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </Example>
    </Block>
  );
}

const ISSUE_DATE = new Date(2026, 9, 14);
const BILLING_FROM = new Date(2026, 9, 1);
const BILLING_TO = new Date(2026, 9, 15);

function CalendarBlock() {
  const [issued, setIssued] = useState<Date | undefined>(ISSUE_DATE);
  const [period, setPeriod] = useState<DateRange | undefined>({
    from: BILLING_FROM,
    to: BILLING_TO,
  });
  const [due, setDue] = useState<Date | undefined>();
  const [today] = useState(() => new Date());
  const [birth, setBirth] = useState<Date | undefined>(new Date(2003, 2, 17));
  return (
    <Block
      description="Days are 32px, 2px chips. The selected day and both ends of a range fill cobalt and go semibold, the days between sit on pane, today sits on pane-2."
      title="Calendar"
      wide
    >
      <div className="flex flex-wrap gap-4">
        <Example label="Single: invoice date">
          <Calendar
            defaultMonth={ISSUE_DATE}
            mode="single"
            onSelect={setIssued}
            selected={issued}
          />
        </Example>
        <Example label="Range: billing period">
          <Calendar
            defaultMonth={BILLING_FROM}
            mode="range"
            numberOfMonths={2}
            onSelect={setPeriod}
            selected={period}
          />
        </Example>
        <Example label="Dropdown caption: date of birth">
          <Calendar
            captionLayout="dropdown"
            defaultMonth={birth}
            endMonth={new Date(2012, 11)}
            mode="single"
            onSelect={setBirth}
            selected={birth}
            startMonth={new Date(1970, 0)}
          />
        </Example>
        <Example label="Past days disabled: due date">
          <Calendar
            defaultMonth={today}
            disabled={{ before: today }}
            mode="single"
            onSelect={setDue}
            selected={due}
          />
        </Example>
      </div>
    </Block>
  );
}

function FormPiecesBlock() {
  const [name, setName] = useState("Rina Wulandari");
  const [email, setEmail] = useState("rina.wulandari@");
  const [summary, setSummary] = useState(
    "Informatics graduate who builds accessible web apps."
  );
  const [amount, setAmount] = useState("2500000");
  const [start, setStart] = useState("2022-08");
  const [end, setEnd] = useState("");
  const [degree, setDegree] = useState("s1");
  return (
    <Block
      description="The builders' composed fields (@rulisme/ui/form): a label, one control and an error line, 6px apart. MonthPicker pairs two native selects."
      title="FormField, FormFieldCustom, MonthPicker"
    >
      <Example label="FormField: text, error, multiline, numeric" paper stack>
        <FormField label="Full name" onChange={setName} value={name} />
        <FormField
          error="Enter a full address, like rina@ub.ac.id."
          label="Email"
          onChange={setEmail}
          type="email"
          value={email}
        />
        <FormField
          label="Summary"
          multiline
          onChange={setSummary}
          value={summary}
        />
        <FormField
          label="Amount (Rp)"
          numeric
          onChange={setAmount}
          value={amount}
        />
      </Example>
      <Example label="Months, a custom control, disabled" stack>
        <FormField
          label="Start date"
          onChange={setStart}
          type="month"
          value={start}
        />
        <FormFieldCustom label="Degree">
          <Select onValueChange={setDegree} value={degree}>
            <SelectTrigger aria-label="Degree" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <DegreeOptions />
            </SelectContent>
          </Select>
        </FormFieldCustom>
        <FormFieldCustom
          error="Pick an end date or tick “I still work here”."
          label="End date"
        >
          <MonthPicker max="2026-10" onChange={setEnd} value={end} />
        </FormFieldCustom>
        <FormField disabled label="CV id" value="cv_8f3k2m" />
      </Example>
    </Block>
  );
}

function PhoneInputBlock() {
  const [phone, setPhone] = useState<string>("+6281234567890");
  return (
    <Block
      description="An international number with a searchable country list. The flag button and the number share one field shell."
      title="PhoneInput"
    >
      <Example label="Typical: Indonesia first" paper stack>
        <Field>
          <FieldLabel htmlFor="phone-main">Phone</FieldLabel>
          <PhoneInput
            defaultCountry="ID"
            id="phone-main"
            onChange={(value) => setPhone(String(value ?? ""))}
            placeholder="812 3456 7890"
            value={phone}
          />
          <FieldDescription>
            Shown on your CV next to your email.
          </FieldDescription>
        </Field>
      </Example>
      <Example label="Sizes: sm · default · lg, invalid, disabled" stack>
        <PhoneInput
          aria-label="Phone, small"
          defaultCountry="ID"
          placeholder="812 3456 7890"
          variant="sm"
        />
        <PhoneInput
          aria-label="Phone, large"
          defaultCountry="SG"
          placeholder="8123 4567"
          variant="lg"
        />
        <PhoneInput
          aria-invalid
          aria-label="Phone, invalid"
          defaultCountry="ID"
          value="+62812"
        />
        <PhoneInput
          aria-label="Phone, disabled"
          defaultCountry="ID"
          disabled
          placeholder="Add a phone number after you sign in"
        />
      </Example>
    </Block>
  );
}

// Renders: Field, Label, Input, InputGroup, Textarea, Select, NativeSelect, Combobox, Checkbox, RadioGroup, Switch, Slider, InputOTP, Calendar, form pieces.
export function InputsSection() {
  return (
    <Section
      id="inputs"
      lead="Fields sit at the same 36px as the buttons beside them, outlined in line and focused in cobalt."
      title="Inputs"
    >
      <BlockGrid>
        <FieldBlock />
        <InputBlock />
        <TextareaBlock />
        <InputGroupBlock />
        <ComboboxBlock />
        <SelectBlock />
        <NativeSelectBlock />
        <LabelBlock />
        <CheckboxBlock />
        <RadioGroupBlock />
        <SwitchBlock />
        <SliderBlock />
        <InputOTPBlock />
        <CalendarBlock />
        <FormPiecesBlock />
        <PhoneInputBlock />
      </BlockGrid>
    </Section>
  );
}
