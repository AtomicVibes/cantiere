import * as React from "react"

import { cn } from "@/lib/utils"
import { CalendarIcon, Clock } from "lucide-react"
import { Input } from "@/components/ui/input"

/**
 * Wraps an Input and renders an inline icon on the far-right edge.
 * Used for date/time pickers whose native indicator is browser-specific
 * (and therefore invisible or clipped in some themes).
 */
const InputWithIcon = React.forwardRef(({ icon, iconClassName, className, ...props }, ref) => {
  return (
    <div className="relative">
      <Input ref={ref} className={cn("pr-9", className)} {...props} />
      <span className={cn(
        "absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
        iconClassName
      )}>
        {icon}
      </span>
    </div>
  );
});
InputWithIcon.displayName = "InputWithIcon"

/**
 * Date input with an always-visible calendar glyph on the right,
 * shown in both light and dark themes.
 */
const DateInput = React.forwardRef(({ className, ...props }, ref) => (
  <InputWithIcon
    ref={ref}
    type="date"
    icon={<CalendarIcon className="w-4 h-4" />}
    className={className}
    {...props}
  />
));
DateInput.displayName = "DateInput"

/**
 * Time input with an always-visible clock glyph on the right,
 * shown in both light and dark themes.
 */
const TimeInput = React.forwardRef(({ className, ...props }, ref) => (
  <InputWithIcon
    ref={ref}
    type="time"
    icon={<Clock className="w-4 h-4" />}
    className={className}
    {...props}
  />
));
TimeInput.displayName = "TimeInput"

export { InputWithIcon, DateInput, TimeInput }