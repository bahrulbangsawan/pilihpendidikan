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

// A run of slots joined by one shared border; the group carries the 8px
// outer radius of the `Input` shell.
function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center rounded-lg", className)}
      data-slot="input-otp-group"
      {...props}
    />
  );
}

// OTP slot: a 36px box in the `Input` shell (10% border on the page colour).
// Neighbours share one border; the active slot lifts over them with the
// field focus (20% border, 2px ink outline) and a blinking caret.
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
        "type-body relative not-first:-ml-px flex size-9 items-center justify-center border border-border bg-background text-foreground tabular-nums outline-none transition-[background-color,border-color] duration-140 ease-standard first:rounded-l-lg last:rounded-r-lg aria-invalid:border-destructive data-[active=true]:z-10 data-[active=true]:border-input data-[active=true]:outline-2 data-[active=true]:outline-ring data-[active=true]:outline-solid data-[active=true]:outline-offset-0 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:outline-destructive",
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
