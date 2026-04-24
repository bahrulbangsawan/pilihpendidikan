"use client";

import { GlobeIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import BasePhoneInput, {
  type Props as BasePhoneInputProps,
  type Country,
  type FlagProps,
  getCountryCallingCode,
  type Value,
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
  return (
    <PhoneInputContext.Provider
      value={{ variant: phoneInputSize, popupClassName, scrollAreaClassName }}
    >
      <BasePhoneInput
        className={cn(
          "flex",
          props["aria-invalid"] &&
            "[&_*[data-slot=combobox-trigger]]:border-destructive [&_*[data-slot=combobox-trigger]]:ring-destructive/50",
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

function InputComponent({ className, ...props }: ComponentProps<typeof Input>) {
  const { variant } = useContext(PhoneInputContext);

  return (
    <Input
      className={cn(
        "rounded-s-none focus:z-1",
        variant === "sm" && "h-6",
        variant === "lg" && "h-8",
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
  const { variant, popupClassName } = useContext(PhoneInputContext);
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
              "flex gap-1 rounded-s-md rounded-e-none border-e-0 px-2.5 py-0 leading-none hover:bg-transparent focus:z-10 data-pressed:bg-transparent",
              disabled && "opacity-50"
            )}
            disabled={disabled}
            size={variant}
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
          className="rounded-none border-0 border-input px-0 py-2.5 shadow-none outline-none! ring-0! focus-visible:border-border focus-visible:ring-0 focus-visible:ring-offset-0"
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="e.g. United States"
          showTrigger={false}
          value={searchValue}
        />
        <ComboboxSeparator />
        <ComboboxEmpty className="px-4 py-2.5 text-sm">
          No country found.
        </ComboboxEmpty>
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
                      <span className="flex-1 text-sm">{item.label}</span>
                      <span className="text-foreground/50 text-sm">
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
    <span className="flex h-4 w-4 items-center justify-center [&_svg:not([class*='size-'])]:size-full! [&_svg:not([class*='size-'])]:rounded-[5px]">
      {Flag ? (
        <Flag title={countryName} />
      ) : (
        <GlobeIcon className="size-4 opacity-60" />
      )}
    </span>
  );
}

export { PhoneInput };
