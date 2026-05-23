import { FormField } from "@rulisme/ui/form/form-field";
import { SectionList } from "@rulisme/ui/form/section-list";
import { Button } from "@rulisme/ui/ui/button";
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
import { Separator } from "@rulisme/ui/ui/separator";
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
import { AddressFields } from "@/components/form/address-fields";
import { DatePicker } from "@/components/form/date-picker";
import { PeriodRangePicker } from "@/components/form/period-range-picker";
import { useTranslation } from "@/i18n";

// ── Types ──────────────────────────────────────────────────

export interface SenderInfo {
  companyName: string;
  address: string;
  city: string;
  kecamatan: string;
  state: string;
  postalCode: string;
  country: string;
  email: string;
  logoUrl: string;
}

export interface RecipientInfo {
  name: string;
  address: string;
  city: string;
  kecamatan: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  email: string;
}

export interface InvoiceSubItem {
  id: string;
  label: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  period: string;
  qty: number;
  unitPrice: number;
  amount: number;
  subItems: Array<InvoiceSubItem>;
}

export interface InvoiceAdjustment {
  id: string;
  label: string;
  type: "add" | "deduct";
  mode: "percentage" | "fixed";
  value: number;
}

export interface InvoiceCustomField {
  id: string;
  label: string;
  value: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  dateOfIssue: string;
  dateDue: string;
  currency: string;
  accentColor: string;
  from: SenderInfo;
  billTo: RecipientInfo;
  items: Array<InvoiceLineItem>;
  adjustments: Array<InvoiceAdjustment>;
  customFields: Array<InvoiceCustomField>;
  notes: string;
  taxRate: number;
}

// ── Currency ───────────────────────────────────────────────

export const CURRENCY_OPTIONS = [
  { value: "USD", flag: "🇺🇸", label: "USD — US Dollar" },
  { value: "EUR", flag: "🇪🇺", label: "EUR — Euro" },
  { value: "GBP", flag: "🇬🇧", label: "GBP — British Pound" },
  { value: "IDR", flag: "🇮🇩", label: "IDR — Indonesian Rupiah" },
  { value: "SGD", flag: "🇸🇬", label: "SGD — Singapore Dollar" },
  { value: "AUD", flag: "🇦🇺", label: "AUD — Australian Dollar" },
  { value: "JPY", flag: "🇯🇵", label: "JPY — Japanese Yen" },
  { value: "MYR", flag: "🇲🇾", label: "MYR — Malaysian Ringgit" },
] as const;

const CURRENCY_LOCALE: Record<string, string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  IDR: "id-ID",
  SGD: "en-SG",
  AUD: "en-AU",
  JPY: "ja-JP",
  MYR: "ms-MY",
};

export function formatCurrency(amount: number, currency: string): string {
  const locale = CURRENCY_LOCALE[currency] ?? "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(amount);
}

// ── Calculations ───────────────────────────────────────────

export function calcSubtotal(items: Array<InvoiceLineItem>): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

export function calcTax(subtotal: number, taxRate: number): number {
  return subtotal * (taxRate / 100);
}

export function calcAdjustmentAmount(
  adj: InvoiceAdjustment,
  subtotal: number
): number {
  const raw =
    adj.mode === "percentage" ? subtotal * (adj.value / 100) : adj.value;
  return adj.type === "deduct" ? -raw : raw;
}

export function calcAdjustmentsTotal(
  adjustments: Array<InvoiceAdjustment>,
  subtotal: number
): number {
  return adjustments.reduce(
    (sum, adj) => sum + calcAdjustmentAmount(adj, subtotal),
    0
  );
}

export function calcTotal(
  items: Array<InvoiceLineItem>,
  taxRate: number,
  adjustments: Array<InvoiceAdjustment> = []
): number {
  const subtotal = calcSubtotal(items);
  const tax = calcTax(subtotal, taxRate);
  const adj = calcAdjustmentsTotal(adjustments, subtotal);
  return subtotal + tax + adj;
}

// ── Form Component ─────────────────────────────────────────

interface InvoiceFormProps {
  data: InvoiceData;
  onChange: (data: InvoiceData) => void;
}

export function InvoiceForm({ data, onChange }: InvoiceFormProps) {
  const { t } = useTranslation();
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

  function reorderItems(items: Array<InvoiceLineItem>) {
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

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      updateFrom("logoUrl", ev.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-6">
      {/* ── Invoice Details ── */}
      <section>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <FileText className="size-4 text-muted-foreground" />{" "}
          {t("form.invoiceDetails")}
        </h2>
        <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_auto]">
          <div className="grid grid-cols-[1fr_auto] items-end gap-3 sm:contents">
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
          <div className="col-span-1 grid grid-cols-2 gap-3 sm:contents">
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
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <Palette className="size-3" /> {t("form.color")}
            </Label>
            <div className="flex items-center gap-1.5">
              <label
                className="flex size-8 shrink-0 cursor-pointer rounded border border-input shadow-sm"
                style={{ backgroundColor: data.accentColor }}
              >
                <input
                  className="sr-only"
                  onChange={(e) => updateField("accentColor", e.target.value)}
                  type="color"
                  value={data.accentColor}
                />
              </label>
              {["#f48120", "#2563eb", "#16a34a", "#dc2626", "#7c3aed"].map(
                (c) => (
                  <button
                    aria-label={t("a11y.setAccentColor", { color: c })}
                    className="size-8 shrink-0 rounded border border-input transition-transform hover:scale-110"
                    key={c}
                    onClick={() => updateField("accentColor", c)}
                    style={{ backgroundColor: c }}
                    type="button"
                  />
                )
              )}
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── From (Sender) ── */}
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex w-full items-center justify-between font-medium text-sm [&[data-state=open]>.chevron]:rotate-180">
          <span className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />{" "}
            {t("form.fromSection")}
          </span>
          <ChevronDown className="chevron size-4 text-muted-foreground transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className="h-8 rounded border object-contain"
                    src={data.from.logoUrl}
                  />
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground">
                  <Upload className="size-3" />
                  {data.from.logoUrl ? t("form.change") : t("form.upload")}
                  <input
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                    type="file"
                  />
                </label>
                {data.from.logoUrl && (
                  <Button
                    aria-label={t("a11y.removeLogo")}
                    onClick={() => updateFrom("logoUrl", "")}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2
                      aria-hidden="true"
                      className="size-3.5 text-destructive"
                    />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* ── Bill To ── */}
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex w-full items-center justify-between font-medium text-sm [&[data-state=open]>.chevron]:rotate-180">
          <span className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" />{" "}
            {t("form.billToSection")}
          </span>
          <ChevronDown className="chevron size-4 text-muted-foreground transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                // Map AddressValues keys to RecipientInfo keys
                const mapped: Partial<RecipientInfo> = {};
                for (const [key, val] of Object.entries(updates)) {
                  if (key === "state") {
                    mapped.stateRegion = val;
                  } else {
                    (mapped as Record<string, string>)[key] = val;
                  }
                }
                onChange({ ...data, billTo: { ...data.billTo, ...mapped } });
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

      <Separator />

      {/* ── Line Items ── */}
      <SectionList
        addLabel={t("form.addItem")}
        items={data.items}
        onAdd={addItem}
        onRemove={removeItem}
        onReorder={reorderItems}
        onTitleChange={() => {}}
        placeholder={t("form.lineItems")}
        renderContent={(item) => (
          <div className="space-y-3">
            <FormField
              label={t("form.description")}
              onChange={(v) => updateItem(item.id, "description", v)}
              placeholder={t("placeholders.description")}
              value={item.description}
            />
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_3.5rem_auto_auto]">
              <PeriodRangePicker
                onChange={(v) => updateItem(item.id, "period", v)}
                value={item.period}
              />
              <div className="grid grid-cols-3 items-end gap-2 sm:contents">
                <FormField
                  label={t("form.qty")}
                  numeric
                  onChange={(v) => updateItem(item.id, "qty", Number(v))}
                  value={String(item.qty)}
                />
                <FormField
                  label={t("form.unitPrice")}
                  numeric
                  onChange={(v) => updateItem(item.id, "unitPrice", Number(v))}
                  value={String(item.unitPrice)}
                />
                <FormField
                  disabled
                  label={t("form.amount")}
                  onChange={() => {}}
                  value={formatCurrency(
                    item.qty * item.unitPrice,
                    data.currency
                  )}
                />
              </div>
            </div>

            {/* Sub-items */}
            {item.subItems.length > 0 && (
              <div className="ml-2 space-y-2 border-muted border-l-2 pl-2 sm:ml-4 sm:pl-4">
                <p className="font-medium text-muted-foreground text-xs">
                  {t("form.subItems")}
                </p>
                {item.subItems.map((sub) => (
                  <div
                    className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 md:grid-cols-[1fr_3.5rem_auto_auto_auto]"
                    key={sub.id}
                  >
                    <FormField
                      label={t("form.label")}
                      onChange={(v) =>
                        updateSubItem(item.id, sub.id, "label", v)
                      }
                      placeholder={t("placeholders.subItemLabel")}
                      value={sub.label}
                    />
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
                      onChange={() => {}}
                      value={formatCurrency(
                        sub.qty * sub.unitPrice,
                        data.currency
                      )}
                    />
                    <Button
                      aria-label={t("a11y.removeSubItem")}
                      onClick={() => removeSubItem(item.id, sub.id)}
                      size="sm"
                      variant="ghost"
                    >
                      <Trash2
                        aria-hidden="true"
                        className="size-3.5 text-destructive"
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
              <Plus className="size-3.5" /> {t("form.addSubItem")}
            </Button>
          </div>
        )}
        summary={(item, i) => item.description || `Item ${i + 1}`}
        title={t("form.lineItems")}
        titleIcon={<ListOrdered className="size-4 text-muted-foreground" />}
      />

      <Separator />

      {/* ── Adjustments ── */}
      <section>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <SlidersHorizontal className="size-4 text-muted-foreground" />{" "}
          {t("form.adjustments")}
        </h2>
        <p className="mt-1 text-muted-foreground text-xs">
          {t("form.adjustmentsDesc")}
        </p>
        <div className="mt-3 space-y-3">
          {data.adjustments.map((adj) => (
            <div
              className="space-y-2 lg:grid lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-end lg:gap-2 lg:space-y-0"
              key={adj.id}
            >
              <FormField
                label={t("form.label")}
                onChange={(v) => updateAdjustment(adj.id, "label", v)}
                placeholder={t("placeholders.adjustmentLabel")}
                value={adj.label}
              />
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <div className="space-y-1.5">
                  <Label>{t("form.type")}</Label>
                  <Select
                    onValueChange={(v) => updateAdjustment(adj.id, "type", v)}
                    value={adj.type}
                  >
                    <SelectTrigger>
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
                    <SelectTrigger>
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
                  className="shrink-0"
                  onClick={() => removeAdjustment(adj.id)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2
                    aria-hidden="true"
                    className="size-3.5 text-destructive"
                  />
                </Button>
              </div>
            </div>
          ))}
          <Button onClick={addAdjustment} size="sm" variant="outline">
            <Plus className="size-3.5" /> {t("form.addAdjustment")}
          </Button>
        </div>
      </section>

      <Separator />

      {/* ── Notes & Settings ── */}
      <section>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <StickyNote className="size-4 text-muted-foreground" />{" "}
          {t("form.notesSettings")}
        </h2>
        <div className="mt-3 space-y-3">
          {data.customFields.map((cf) => (
            <div
              className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
              key={cf.id}
            >
              <FormField
                label={t("form.label")}
                onChange={(v) => updateCustomField(cf.id, "label", v)}
                placeholder={t("placeholders.customFieldLabel")}
                value={cf.label}
              />
              <div className="col-span-1 flex items-end gap-2 sm:contents">
                <div className="min-w-0 flex-1">
                  <FormField
                    label={t("form.value")}
                    onChange={(v) => updateCustomField(cf.id, "value", v)}
                    placeholder={t("placeholders.customFieldValue")}
                    value={cf.value}
                  />
                </div>
                <Button
                  aria-label={t("a11y.removeField")}
                  className="shrink-0 sm:hidden"
                  onClick={() => removeCustomField(cf.id)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </Button>
              </div>
              <Button
                aria-label={t("a11y.removeField")}
                className="hidden sm:inline-flex"
                onClick={() => removeCustomField(cf.id)}
                size="sm"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button onClick={addCustomField} size="sm" variant="outline">
            <Plus className="size-3.5" /> {t("form.addField")}
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
