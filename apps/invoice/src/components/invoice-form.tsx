import { FormField } from "@rulisme/ui/form/form-field";
import { SectionList } from "@rulisme/ui/form/section-list";
import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rulisme/ui/ui/collapsible";
import { Label } from "@rulisme/ui/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  Building2,
  ChevronDown,
  FileText,
  ListOrdered,
  Palette,
  Plus,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { AddressFields } from "@/components/form/address-fields";
import { DatePicker } from "@/components/form/date-picker";
import { PeriodRangePicker } from "@/components/form/period-range-picker";
import type {
  InvoiceAdjustment,
  InvoiceData,
  InvoiceLineItem,
  InvoiceSubItem,
  RecipientInfo,
  SenderInfo,
} from "@/components/invoice-form-utils";
import { formatCurrency } from "@/components/invoice-form-utils";
import { useTranslation } from "@/i18n";
import { preprocessImage } from "@/lib/preprocess-image";

// Re-export types for consumers that import from this module
export type {
  InvoiceAdjustment,
  InvoiceCustomField,
  InvoiceData,
  InvoiceLineItem,
  InvoiceSubItem,
  RecipientInfo,
  SenderInfo,
} from "@/components/invoice-form-utils";

// Logos render at ~h-8 in the editor and small in the PDF, so 320px on the long
// edge stays crisp while keeping the embed tiny. PNG logos keep their alpha.
const LOGO_MAX_EDGE = 320;

// The invoice's accent-colour presets. Document content (the user's branding
// on the printed invoice), not chrome, so they stay raw hex.
const ACCENT_PRESETS = [
  "#f48120",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
] as const;

// Each form section is a band of the form pane, ruled by a 1px `line`
// hairline (DESIGN.md § Layout). The form is a size container, so its grids
// follow the pane's width rather than the viewport's.
const SECTION_CLASS = "border-line border-b px-4 py-6 last:border-b-0 sm:px-6";

// Swatches are 2px tiles at control height; focus draws the action outline.
const SWATCH_CLASS =
  "size-9 shrink-0 rounded-sm border border-input transition-[border-color] duration-150 ease-standard hover:border-muted-foreground";

const FOCUS_WITHIN_CLASS =
  "has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:outline-solid has-focus-visible:outline-offset-2";

// ── Currency (internal to this file only) ─────────────────

const CURRENCY_OPTIONS = [
  { value: "USD", flag: "🇺🇸", label: "USD — US Dollar" },
  { value: "EUR", flag: "🇪🇺", label: "EUR — Euro" },
  { value: "GBP", flag: "🇬🇧", label: "GBP — British Pound" },
  { value: "IDR", flag: "🇮🇩", label: "IDR — Indonesian Rupiah" },
  { value: "SGD", flag: "🇸🇬", label: "SGD — Singapore Dollar" },
  { value: "AUD", flag: "🇦🇺", label: "AUD — Australian Dollar" },
  { value: "JPY", flag: "🇯🇵", label: "JPY — Japanese Yen" },
  { value: "MYR", flag: "🇲🇾", label: "MYR — Malaysian Ringgit" },
] as const;

// ── Section chrome ─────────────────────────────────────────

// A section heading: subtitle role at the heading weight with a muted 16px
// icon, on the same 32px row as the line-items title beside it.
function SectionHeading({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <h2 className="type-subtitle weight-semibold flex h-8 items-center gap-1.5 text-foreground">
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 text-muted-foreground"
      >
        {icon}
      </span>
      {children}
    </h2>
  );
}

// The whole heading row toggles a collapsible section; the chevron flips
// instantly (nothing animates layout).
function SectionToggle({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <CollapsibleTrigger className="flex h-8 w-full items-center justify-between gap-3 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 [&[data-state=open]>.chevron]:rotate-180">
      <span className="type-subtitle weight-semibold flex items-center gap-1.5 text-foreground">
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 text-muted-foreground"
        >
          {icon}
        </span>
        {children}
      </span>
      <ChevronDown
        aria-hidden="true"
        className="chevron size-4 shrink-0 text-muted-foreground"
      />
    </CollapsibleTrigger>
  );
}

// ── Form Component ─────────────────────────────────────────

interface InvoiceFormProps {
  data: InvoiceData;
  onChange: (data: InvoiceData) => void;
}

export function InvoiceForm({ data, onChange }: InvoiceFormProps) {
  const { t } = useTranslation();
  const [logoError, setLogoError] = useState<string | undefined>(undefined);

  function updateField<K extends keyof InvoiceData>(
    field: K,
    value: InvoiceData[K]
  ) {
    onChange({ ...data, [field]: value });
  }

  function updateFrom(field: keyof SenderInfo, value: string) {
    onChange({ ...data, from: { ...data.from, [field]: value } });
  }

  function updateBillTo(field: keyof RecipientInfo, value: string) {
    onChange({ ...data, billTo: { ...data.billTo, [field]: value } });
  }

  // ── Line items ──

  function addItem() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      items: [
        ...data.items,
        {
          id,
          description: "",
          period: "",
          qty: 0,
          unitPrice: 0,
          amount: 0,
          subItems: [],
        },
      ],
    });
  }

  function removeItem(id: string) {
    onChange({ ...data, items: data.items.filter((i) => i.id !== id) });
  }

  function updateItem(
    id: string,
    field: keyof Omit<InvoiceLineItem, "id" | "subItems">,
    value: string | number
  ) {
    onChange({
      ...data,
      items: data.items.map((item) => {
        if (item.id !== id) {
          return item;
        }
        const updated = { ...item, [field]: value };
        if (field === "qty" || field === "unitPrice") {
          const ownAmount = Number(updated.qty) * Number(updated.unitPrice);
          const subTotal = updated.subItems.reduce((s, si) => s + si.amount, 0);
          updated.amount = ownAmount + subTotal;
        }
        return updated;
      }),
    });
  }

  function reorderItems(items: InvoiceLineItem[]) {
    onChange({ ...data, items });
  }

  // ── Sub-items ──

  function addSubItem(itemId: string) {
    onChange({
      ...data,
      items: data.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          subItems: [
            ...item.subItems,
            {
              id: crypto.randomUUID(),
              label: "",
              qty: 0,
              unitPrice: 0,
              amount: 0,
            },
          ],
        };
      }),
    });
  }

  function removeSubItem(itemId: string, subId: string) {
    onChange({
      ...data,
      items: data.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        const newSubItems = item.subItems.filter((s) => s.id !== subId);
        const ownAmount = Number(item.qty) * Number(item.unitPrice);
        const subTotal = newSubItems.reduce((s, si) => s + si.amount, 0);
        return { ...item, subItems: newSubItems, amount: ownAmount + subTotal };
      }),
    });
  }

  function updateSubItem(
    itemId: string,
    subId: string,
    field: keyof Omit<InvoiceSubItem, "id">,
    value: string | number
  ) {
    onChange({
      ...data,
      items: data.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        const newSubItems = item.subItems.map((sub) => {
          if (sub.id !== subId) {
            return sub;
          }
          const updated = { ...sub, [field]: value };
          if (field === "qty" || field === "unitPrice") {
            updated.amount = Number(updated.qty) * Number(updated.unitPrice);
          }
          return updated;
        });
        const ownAmount = Number(item.qty) * Number(item.unitPrice);
        const subTotal = newSubItems.reduce((s, si) => s + si.amount, 0);
        return { ...item, subItems: newSubItems, amount: ownAmount + subTotal };
      }),
    });
  }

  // ── Adjustments ──

  function addAdjustment() {
    onChange({
      ...data,
      adjustments: [
        ...data.adjustments,
        {
          id: crypto.randomUUID(),
          label: "",
          type: "deduct",
          mode: "fixed",
          value: 0,
        },
      ],
    });
  }

  function removeAdjustment(id: string) {
    onChange({
      ...data,
      adjustments: data.adjustments.filter((a) => a.id !== id),
    });
  }

  function updateAdjustment(
    id: string,
    field: keyof Omit<InvoiceAdjustment, "id">,
    value: string | number
  ) {
    onChange({
      ...data,
      adjustments: data.adjustments.map((a) =>
        a.id === id ? { ...a, [field]: value } : a
      ),
    });
  }

  // ── Custom fields ──

  function addCustomField() {
    onChange({
      ...data,
      customFields: [
        ...data.customFields,
        { id: crypto.randomUUID(), label: "", value: "" },
      ],
    });
  }

  function removeCustomField(id: string) {
    onChange({
      ...data,
      customFields: data.customFields.filter((f) => f.id !== id),
    });
  }

  function updateCustomField(
    id: string,
    field: "label" | "value",
    value: string
  ) {
    onChange({
      ...data,
      customFields: data.customFields.map((f) =>
        f.id === id ? { ...f, [field]: value } : f
      ),
    });
  }

  // ── Logo upload ──

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }
    try {
      const logoUrl = await preprocessImage(file, { maxEdge: LOGO_MAX_EDGE });
      setLogoError(undefined);
      updateFrom("logoUrl", logoUrl);
    } catch {
      setLogoError(t("errors.logoProcess"));
    }
  }

  return (
    <div className="@container/form flex flex-col">
      {/* ── Invoice Details ── */}
      <section className={SECTION_CLASS}>
        <SectionHeading icon={<FileText className="size-4" />}>
          {t("form.invoiceDetails")}
        </SectionHeading>
        <div className="mt-3 grid @xl/form:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)] grid-cols-1 items-end gap-3">
          <div className="grid @xl/form:contents grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <FormField
              label={t("form.invoiceNumber")}
              onChange={(v) => updateField("invoiceNumber", v)}
              placeholder={t("placeholders.invoiceNumber")}
              value={data.invoiceNumber}
            />
            <div className="space-y-1.5">
              <Label>{t("form.currency")}</Label>
              <Select
                onValueChange={(v) => updateField("currency", v)}
                value={data.currency}
              >
                <SelectTrigger className="w-auto">
                  <SelectValue>
                    {(() => {
                      const c = CURRENCY_OPTIONS.find(
                        (o) => o.value === data.currency
                      );
                      return c ? `${c.flag} ${c.value}` : data.currency;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.flag} {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid @xl/form:contents grid-cols-2 items-end gap-3">
            <DatePicker
              label={t("form.dateOfIssue")}
              onChange={(v) => updateField("dateOfIssue", v)}
              value={data.dateOfIssue}
            />
            <DatePicker
              label={t("form.dateDue")}
              onChange={(v) => updateField("dateDue", v)}
              value={data.dateDue}
            />
          </div>
          <div className="@xl/form:col-span-full space-y-1.5">
            <Label className="gap-1.5">
              <Palette
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              {t("form.color")}
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <label
                aria-label={t("a11y.setAccentColor", {
                  color: data.accentColor,
                })}
                className={cn(
                  SWATCH_CLASS,
                  "flex cursor-pointer",
                  FOCUS_WITHIN_CLASS
                )}
                style={{ backgroundColor: data.accentColor }}
              >
                <input
                  aria-label={t("a11y.setAccentColor", {
                    color: data.accentColor,
                  })}
                  className="sr-only"
                  onChange={(e) => updateField("accentColor", e.target.value)}
                  type="color"
                  value={data.accentColor}
                />
              </label>
              {ACCENT_PRESETS.map((c) => (
                <button
                  aria-label={t("a11y.setAccentColor", { color: c })}
                  className={cn(
                    SWATCH_CLASS,
                    "press outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
                  )}
                  key={c}
                  onClick={() => updateField("accentColor", c)}
                  style={{ backgroundColor: c }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── From (Sender) ── */}
      <Collapsible className={SECTION_CLASS} defaultOpen>
        <SectionToggle icon={<Building2 className="size-4" />}>
          {t("form.fromSection")}
        </SectionToggle>
        <CollapsibleContent>
          <div className="mt-3 space-y-3">
            <div className="grid @md/form:grid-cols-2 grid-cols-1 gap-3">
              <FormField
                label={t("form.companyName")}
                onChange={(v) => updateFrom("companyName", v)}
                placeholder={t("placeholders.companyName")}
                value={data.from.companyName}
              />
              <FormField
                label={t("form.email")}
                onChange={(v) => updateFrom("email", v)}
                placeholder={t("placeholders.emailSender")}
                type="email"
                value={data.from.email}
              />
            </div>
            <FormField
              label={t("form.address")}
              multiline
              onChange={(v) => updateFrom("address", v)}
              placeholder={t("placeholders.addressSender")}
              rows={2}
              value={data.from.address}
            />
            <AddressFields
              cityPlaceholder={t("placeholders.citySender")}
              onChange={(updates) =>
                onChange({ ...data, from: { ...data.from, ...updates } })
              }
              stateLabel={t("form.state")}
              statePlaceholder={t("placeholders.stateSender")}
              values={{
                city: data.from.city,
                kecamatan: data.from.kecamatan,
                state: data.from.state,
                postalCode: data.from.postalCode,
                country: data.from.country,
              }}
            />
            <div className="space-y-1.5">
              <Label>{t("form.companyLogo")}</Label>
              <div className="flex items-center gap-2">
                {data.from.logoUrl && (
                  <img
                    alt=""
                    className="h-8 w-auto rounded-sm border border-border object-contain"
                    decoding="async"
                    height={32}
                    loading="lazy"
                    src={data.from.logoUrl}
                    width={32}
                  />
                )}
                <label
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "cursor-pointer",
                    FOCUS_WITHIN_CLASS
                  )}
                >
                  <Upload aria-hidden="true" data-icon="inline-start" />
                  {data.from.logoUrl ? t("form.change") : t("form.upload")}
                  <input
                    accept="image/*"
                    aria-label={
                      data.from.logoUrl ? t("form.change") : t("form.upload")
                    }
                    className="sr-only"
                    onChange={handleLogoUpload}
                    type="file"
                  />
                </label>
                {data.from.logoUrl && (
                  <Button
                    aria-label={t("a11y.removeLogo")}
                    onClick={() => updateFrom("logoUrl", "")}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="text-destructive" />
                  </Button>
                )}
              </div>
              {logoError && (
                <p className="type-caption text-destructive">{logoError}</p>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Bill To ── */}
      <Collapsible className={SECTION_CLASS} defaultOpen>
        <SectionToggle icon={<UserRound className="size-4" />}>
          {t("form.billToSection")}
        </SectionToggle>
        <CollapsibleContent>
          <div className="mt-3 space-y-3">
            <div className="grid @md/form:grid-cols-2 grid-cols-1 gap-3">
              <FormField
                label={t("form.name")}
                onChange={(v) => updateBillTo("name", v)}
                placeholder={t("placeholders.clientName")}
                value={data.billTo.name}
              />
              <FormField
                label={t("form.email")}
                onChange={(v) => updateBillTo("email", v)}
                placeholder={t("placeholders.clientEmail")}
                type="email"
                value={data.billTo.email}
              />
            </div>
            <FormField
              label={t("form.address")}
              multiline
              onChange={(v) => updateBillTo("address", v)}
              placeholder={t("placeholders.clientAddress")}
              rows={2}
              value={data.billTo.address}
            />
            <AddressFields
              cityPlaceholder={t("placeholders.cityRecipient")}
              onChange={(updates) => {
                const { state, ...recipientUpdates } = updates;
                const billTo = { ...data.billTo, ...recipientUpdates };
                if (state !== undefined) {
                  billTo.stateRegion = state;
                }
                onChange({ ...data, billTo });
              }}
              stateLabel={t("form.stateRegion")}
              statePlaceholder={t("placeholders.stateRecipient")}
              values={{
                city: data.billTo.city,
                kecamatan: data.billTo.kecamatan,
                state: data.billTo.stateRegion,
                postalCode: data.billTo.postalCode,
                country: data.billTo.country,
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Line Items ── */}
      <div className={SECTION_CLASS}>
        <SectionList
          addLabel={t("form.addItem")}
          items={data.items}
          onAdd={addItem}
          onRemove={removeItem}
          onReorder={reorderItems}
          placeholder={t("form.lineItems")}
          removeLabel={t("a11y.removeItem")}
          reorderLabel={t("a11y.dragToReorder")}
          renderContent={(item) => (
            <div className="space-y-3">
              <FormField
                label={t("form.description")}
                onChange={(v) => updateItem(item.id, "description", v)}
                placeholder={t("placeholders.description")}
                value={item.description}
              />
              <div className="grid @xl/form:grid-cols-[minmax(0,1.5fr)_3.5rem_minmax(0,0.8fr)_minmax(0,1fr)] grid-cols-1 items-end gap-3">
                <PeriodRangePicker
                  onChange={(v) => updateItem(item.id, "period", v)}
                  value={item.period}
                />
                <div className="grid @xl/form:contents grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2 tabular-nums">
                  <FormField
                    label={t("form.qty")}
                    numeric
                    onChange={(v) => updateItem(item.id, "qty", Number(v))}
                    value={String(item.qty)}
                  />
                  <FormField
                    label={t("form.unitPrice")}
                    numeric
                    onChange={(v) =>
                      updateItem(item.id, "unitPrice", Number(v))
                    }
                    value={String(item.unitPrice)}
                  />
                  <FormField
                    disabled
                    label={t("form.amount")}
                    value={formatCurrency(
                      item.qty * item.unitPrice,
                      data.currency
                    )}
                  />
                </div>
              </div>

              {/* Sub-items */}
              {item.subItems.length > 0 && (
                <div className="@md/form:ml-1 flex flex-col gap-2 border-line border-l @md/form:pl-4 pl-3">
                  <p className="type-caption text-muted-foreground">
                    {t("form.subItems")}
                  </p>
                  {item.subItems.map((sub) => (
                    <div
                      className="grid @xl/form:grid-cols-[minmax(0,1.2fr)_3.5rem_minmax(0,0.8fr)_minmax(0,1fr)_auto] grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 tabular-nums"
                      key={sub.id}
                    >
                      <div className="@xl/form:col-span-1 col-span-full">
                        <FormField
                          label={t("form.label")}
                          onChange={(v) =>
                            updateSubItem(item.id, sub.id, "label", v)
                          }
                          placeholder={t("placeholders.subItemLabel")}
                          value={sub.label}
                        />
                      </div>
                      <FormField
                        label={t("form.qty")}
                        numeric
                        onChange={(v) =>
                          updateSubItem(item.id, sub.id, "qty", Number(v))
                        }
                        value={String(sub.qty)}
                      />
                      <FormField
                        label={t("form.unitPrice")}
                        numeric
                        onChange={(v) =>
                          updateSubItem(item.id, sub.id, "unitPrice", Number(v))
                        }
                        value={String(sub.unitPrice)}
                      />
                      <FormField
                        disabled
                        label={t("form.amount")}
                        value={formatCurrency(
                          sub.qty * sub.unitPrice,
                          data.currency
                        )}
                      />
                      <Button
                        aria-label={t("a11y.removeSubItem")}
                        onClick={() => removeSubItem(item.id, sub.id)}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2
                          aria-hidden="true"
                          className="text-destructive"
                        />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                onClick={() => addSubItem(item.id)}
                size="sm"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t("form.addSubItem")}
              </Button>
            </div>
          )}
          summary={(item, i) =>
            item.description || t("form.itemFallback", { n: i + 1 })
          }
          title={t("form.lineItems")}
          titleIcon={<ListOrdered className="size-4" />}
        />
      </div>

      {/* ── Adjustments ── */}
      <section className={SECTION_CLASS}>
        <SectionHeading icon={<SlidersHorizontal className="size-4" />}>
          {t("form.adjustments")}
        </SectionHeading>
        <p className="type-caption text-muted-foreground">
          {t("form.adjustmentsDesc")}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {data.adjustments.map((adj) => (
            <div
              className="grid @xl/form:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] grid-cols-1 items-end gap-2"
              key={adj.id}
            >
              <FormField
                label={t("form.label")}
                onChange={(v) => updateAdjustment(adj.id, "label", v)}
                placeholder={t("placeholders.adjustmentLabel")}
                value={adj.label}
              />
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 tabular-nums">
                <div className="space-y-1.5">
                  <Label>{t("form.type")}</Label>
                  <Select
                    onValueChange={(v) => updateAdjustment(adj.id, "type", v)}
                    value={adj.type}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="add">{t("form.typeAdd")}</SelectItem>
                      <SelectItem value="deduct">
                        {t("form.typeDeduct")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("form.mode")}</Label>
                  <Select
                    onValueChange={(v) => updateAdjustment(adj.id, "mode", v)}
                    value={adj.mode}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">
                        {t("form.modeFixed")}
                      </SelectItem>
                      <SelectItem value="percentage">
                        {t("form.modePercentage")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <FormField
                  label={
                    adj.mode === "percentage"
                      ? t("form.modePercentage")
                      : t("form.amount")
                  }
                  min={0}
                  onChange={(v) => updateAdjustment(adj.id, "value", Number(v))}
                  step={adj.mode === "percentage" ? "0.1" : "0.01"}
                  type="number"
                  value={String(adj.value)}
                />
                <Button
                  aria-label={t("a11y.removeAdjustment")}
                  onClick={() => removeAdjustment(adj.id)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            className="self-start"
            onClick={addAdjustment}
            size="sm"
            variant="outline"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t("form.addAdjustment")}
          </Button>
        </div>
      </section>

      {/* ── Notes & Settings ── */}
      <section className={SECTION_CLASS}>
        <SectionHeading icon={<StickyNote className="size-4" />}>
          {t("form.notesSettings")}
        </SectionHeading>
        <div className="mt-3 flex flex-col gap-3">
          {data.customFields.map((cf) => (
            <div
              className="grid @md/form:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
              key={cf.id}
            >
              <div className="@md/form:col-span-1 col-span-full">
                <FormField
                  label={t("form.label")}
                  onChange={(v) => updateCustomField(cf.id, "label", v)}
                  placeholder={t("placeholders.customFieldLabel")}
                  value={cf.label}
                />
              </div>
              <FormField
                label={t("form.value")}
                onChange={(v) => updateCustomField(cf.id, "value", v)}
                placeholder={t("placeholders.customFieldValue")}
                value={cf.value}
              />
              <Button
                aria-label={t("a11y.removeField")}
                onClick={() => removeCustomField(cf.id)}
                size="icon"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            className="self-start"
            onClick={addCustomField}
            size="sm"
            variant="outline"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t("form.addField")}
          </Button>
          <FormField
            label={t("form.notes")}
            multiline
            onChange={(v) => updateField("notes", v)}
            placeholder={t("placeholders.notes")}
            rows={3}
            value={data.notes}
          />
        </div>
      </section>
    </div>
  );
}
