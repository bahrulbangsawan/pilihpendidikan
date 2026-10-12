import { OTPInput, OTPInputContext } from "input-otp";
import { MinusIcon } from "lucide-react";
import type * as React from "react";
import { use } from "react";
import { cn } from "../lib/utils";

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string;
}) {
  return (
    <OTPInput
      className={cn("disabled:cursor-not-allowed", className)}
      containerClassName={cn(
        "flex items-center gap-2 has-disabled:opacity-60",
        containerClassName
      )}
      data-slot="input-otp"
      spellCheck={false}
      {...props}
    />
  );
}

// A run of slots joined by hairlines; the group carries the 4px outer radius
// and, when a slot is invalid, the destructive halo.
function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center rounded-md has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/15",
        className
      )}
      data-slot="input-otp-group"
      {...props}
    />
  );
}

// Zedative OTP slot: a 36px box on half-transparent paper. Neighbours share
// one `line` hairline; the active slot lifts over them with the field focus
// (cobalt edge and halo) and a blinking caret.
function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number;
}) {
  const inputOTPContext = use(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {};

  return (
    <div
      className={cn(
        "type-body relative not-first:-ml-px flex size-9 items-center justify-center border border-input bg-card/60 text-foreground tabular-nums outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard first:rounded-l-md last:rounded-r-md aria-invalid:border-destructive data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/20 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/15",
        className
      )}
      data-active={isActive}
      data-slot="input-otp-slot"
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground" />
        </div>
      )}
    </div>
  );
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the separator draws a dash icon between slot groups; an <hr> cannot hold the icon
    <div
      className="flex items-center text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
      data-slot="input-otp-separator"
      role="separator"
      {...props}
    >
      <MinusIcon />
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
