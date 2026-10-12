import { GlobeIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, use, useMemo, useState } from "react";
import BasePhoneInput, {
  getCountryCallingCode,
} from "react-phone-number-input";
import type {
  Props as BasePhoneInputProps,
  Country,
  FlagProps,
  Value,
} from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "../ui/combobox";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

type PhoneInputSize = "sm" | "default" | "lg";

// The country button and the number field share one height: 32 / 36 / 40px.
const TRIGGER_SIZE = {
  sm: "sm",
  default: "default",
  lg: "lg",
} as const satisfies Record<PhoneInputSize, string>;

const PhoneInputContext = createContext<{
  variant: PhoneInputSize;
  popupClassName?: string;
  scrollAreaClassName?: string;
}>({
  variant: "default",
  popupClassName: undefined,
  scrollAreaClassName: undefined,
});

type PhoneInputProps = Omit<
  ComponentProps<"input">,
  "onChange" | "value" | "ref"
> &
  Omit<
    BasePhoneInputProps<typeof BasePhoneInput>,
    "onChange" | "variant" | "popupClassName" | "scrollAreaClassName"
  > & {
    onChange?: (value: Value) => void;
    variant?: PhoneInputSize;
    popupClassName?: string;
    scrollAreaClassName?: string;
  };

function PhoneInput({
  className,
  variant,
  popupClassName,
  scrollAreaClassName,
  onChange,
  value,
  ...props
}: PhoneInputProps) {
  const phoneInputSize = variant || "default";
  const contextValue = useMemo(
    () => ({ variant: phoneInputSize, popupClassName, scrollAreaClassName }),
    [phoneInputSize, popupClassName, scrollAreaClassName]
  );
  return (
    <PhoneInputContext.Provider value={contextValue}>
      <BasePhoneInput
        className={cn(
          "flex min-w-0",
          props["aria-invalid"] &&
            "[&_[data-slot=combobox-trigger]]:border-destructive",
          className
        )}
        countrySelectComponent={CountrySelect}
        flagComponent={FlagComponent}
        inputComponent={InputComponent}
        onChange={(value) => onChange?.(value || ("" as Value))}
        smartCaret={false}
        value={value || undefined}
        {...props}
      />
    </PhoneInputContext.Provider>
  );
}

// Zedative phone field: the country button and the number share one field
// shell — the button keeps the shell's `line` edge and paper (no lip), the
// number field closes the shape with the shared hairline.
function InputComponent({ className, ...props }: ComponentProps<typeof Input>) {
  const { variant } = use(PhoneInputContext);

  return (
    <Input
      className={cn(
        "rounded-s-none focus:z-1",
        variant === "sm" && "h-8",
        variant === "lg" && "h-10",
        className
      )}
      {...props}
    />
  );
}

interface CountryEntry {
  label: string;
  value: Country | undefined;
}

interface CountrySelectProps {
  disabled?: boolean;
  value: Country;
  options: CountryEntry[];
  onChange: (country: Country) => void;
}

function CountrySelect({
  disabled,
  value: selectedCountry,
  options: countryList,
  onChange,
}: CountrySelectProps) {
  const { variant, popupClassName } = use(PhoneInputContext);
  const [searchValue, setSearchValue] = useState("");

  const filteredCountries = useMemo(() => {
    if (!searchValue) {
      return countryList;
    }
    return countryList.filter(({ label }) =>
      label.toLowerCase().includes(searchValue.toLowerCase())
    );
  }, [countryList, searchValue]);

  return (
    <Combobox
      items={filteredCountries}
      onValueChange={(country: Country | null) => {
        if (country) {
          onChange(country);
        }
      }}
      value={selectedCountry || ""}
    >
      <ComboboxTrigger
        render={
          <Button
            className={cn(
              "inset-shadow-none flex gap-1 rounded-s-md rounded-e-none border-input border-e-0 bg-card/60 px-2.5 py-0 focus:z-10 focus-visible:outline-solid data-pressed:bg-pane/70",
              disabled && "opacity-50"
            )}
            disabled={disabled}
            size={TRIGGER_SIZE[variant]}
            variant="outline"
          >
            <span className="sr-only">
              <ComboboxValue />
            </span>
            <FlagComponent
              country={selectedCountry}
              countryName={selectedCountry}
            />
          </Button>
        }
      />
      <ComboboxContent
        className={cn(
          "w-xs *:data-[slot=input-group]:bg-transparent",
          popupClassName
        )}
      >
        <ComboboxInput
          className="rounded-none border-0 bg-transparent px-0 ring-0!"
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="e.g. United States"
          showTrigger={false}
          value={searchValue}
        />
        <ComboboxSeparator />
        <ComboboxEmpty>No country found.</ComboboxEmpty>
        <ComboboxList>
          <div className="relative flex max-h-full">
            <div className="flex max-h-[min(var(--available-height),24rem)] w-full scroll-pt-2 scroll-pb-2 flex-col overscroll-contain">
              <ScrollArea className="size-full min-h-0 **:data-[slot=scroll-area-scrollbar]:m-0 [&_[data-slot=scroll-area-viewport]]:h-full [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
                {filteredCountries.map((item: CountryEntry) =>
                  item.value ? (
                    <ComboboxItem
                      className="flex items-center gap-2"
                      key={item.value}
                      value={item.value}
                    >
                      <FlagComponent
                        country={item.value}
                        countryName={item.label}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      <span className="type-caption text-muted-foreground tabular-nums">
                        {`+${getCountryCallingCode(item.value)}`}
                      </span>
                    </ComboboxItem>
                  ) : null
                )}
              </ScrollArea>
            </div>
          </div>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function FlagComponent({ country, countryName }: FlagProps) {
  const Flag = flags[country];

  return (
    <span className="flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-full! [&_svg:not([class*='size-'])]:rounded-sm">
      {Flag ? (
        <Flag title={countryName} />
      ) : (
        <GlobeIcon className="size-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

export { PhoneInput };
