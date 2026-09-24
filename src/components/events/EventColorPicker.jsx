import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EVENT_COLOR_PALETTE,
  getAppAccentColor,
  getEventHexColorName,
  isValidHexColor,
} from '@/lib/eventColors';

// Reusable event color picker: visual palette + selected preview + custom
// color input + human-readable color name. HEX is only secondary technical
// info, never the primary user-facing label.
export default function EventColorPicker({ value, onChange, accentColor, id = 'event-color' }) {
  const { t } = useTranslation();
  const accent = accentColor || getAppAccentColor();
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : null;
  const selectedName = normalized
    ? getEventHexColorName(normalized, t)
    : t('eventColors.defaultColor', 'Default color');

  const handleCustomInput = (e) => {
    const next = e.target.value;
    if (isValidHexColor(next)) onChange(next.toUpperCase());
  };

  const isCustomSelected =
    normalized &&
    !EVENT_COLOR_PALETTE.some((c) => c.hex.toUpperCase() === normalized) &&
    normalized !== accent.toUpperCase();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="w-5 h-5 rounded-full border border-border flex-shrink-0"
          style={{ backgroundColor: normalized || accent }}
        />
        <p aria-live="polite" className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t('eventColors.selectedColor', 'Selected color')}: </span>
          <span>{selectedName}</span>
          {normalized && (
            <span dir="ltr" className="ms-1 text-[11px] text-muted-foreground/80">
              ({normalized})
            </span>
          )}
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label={t('eventColors.eventColor', 'Event color')}
        className="flex flex-wrap gap-2"
      >
        {EVENT_COLOR_PALETTE.map((color) => {
          const hex = color.hex.toUpperCase();
          const selected = normalized === hex;
          const name = getEventHexColorName(hex, t);
          return (
            <button
              key={color.key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={name}
              title={name}
              onClick={() => onChange(hex)}
              className={cn(
                'w-8 h-8 rounded-full border border-border transition-transform',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background scale-110'
              )}
              style={{ backgroundColor: hex }}
            >
              {selected && (
                <Check
                  aria-hidden
                  className="w-4 h-4 mx-auto text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                />
              )}
            </button>
          );
        })}

        <label
          htmlFor={`${id}-custom`}
          title={t('eventColors.customColor', 'Custom color')}
          className={cn(
            'relative w-8 h-8 rounded-full border border-dashed border-muted-foreground/60 overflow-hidden cursor-pointer',
            'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
            isCustomSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background scale-110'
          )}
          style={
            isCustomSelected
              ? { backgroundColor: normalized }
              : {
                  background:
                    'conic-gradient(#EF4444, #F59E0B, #10B981, #3B82F6, #8B5CF6, #EF4444)',
                }
          }
        >
          <span className="sr-only">{t('eventColors.customColor', 'Custom color')}</span>
          {isCustomSelected && (
            <Check
              aria-hidden
              className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
            />
          )}
          <input
            id={`${id}-custom`}
            type="color"
            value={normalized && isValidHexColor(normalized) ? normalized : accent}
            onChange={handleCustomInput}
            aria-label={t('eventColors.customColor', 'Custom color')}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}
