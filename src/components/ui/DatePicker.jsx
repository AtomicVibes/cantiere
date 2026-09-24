import React from 'react';
import { useTranslation } from 'react-i18next';
import { enUS, fr, ar, it } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { useDirection } from '@/i18n/LanguageProvider';
import { cn } from '@/lib/utils';
import {
  formatDateOnlyDisplay,
  isValidDateOnlyString,
  parseDateOnly,
  toDateOnlyString,
} from '@/lib/dates';

const LOCALES = { en: enUS, fr, ar, it };

function localeFor(lang) {
  if (!lang || typeof lang !== 'string') return enUS;
  const base = lang.split('-')[0].toLowerCase();
  return LOCALES[base] ?? enUS;
}

// Canonical shared date picker, extracted from the New Invoice form without
// changing its appearance or behavior: popover trigger button showing the
// date as dd/MM/yyyy (or a placeholder), calendar popover in single mode,
// date-only YYYY-MM-DD values with no UTC conversion. Used by every form
// that requires date selection (invoice, event, project, request, timeline).
export default function DatePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  required = false,
  id,
  name,
  min,
  max,
  allowClear = true,
  align = 'start',
  className,
  ariaLabel,
}) {
  const { t, i18n } = useTranslation();
  const { dir } = useDirection();
  const [open, setOpen] = React.useState(false);

  const normalized = typeof value === 'string' ? value : '';
  const selected = parseDateOnly(normalized);
  const display = formatDateOnlyDisplay(normalized);

  const disabledMatcher = React.useMemo(() => {
    const matchers = [];
    if (isValidDateOnlyString(min)) {
      const minDate = parseDateOnly(min);
      matchers.push((day) => day < minDate);
    }
    if (isValidDateOnlyString(max)) {
      const maxDate = parseDateOnly(max);
      matchers.push((day) => day > maxDate);
    }
    if (matchers.length === 0) return undefined;
    return (day) => matchers.some((fn) => fn(day));
  }, [min, max]);

  const handleSelect = (day) => {
    const next = day instanceof Date ? toDateOnlyString(day) : '';
    onChange?.(next);
    if (day instanceof Date) setOpen(false);
  };

  const handleClear = () => {
    onChange?.('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel || placeholder || t('date')}
          aria-required={required || undefined}
          className={cn(
            'w-full justify-start text-left font-normal',
            !display && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {display || (
            <span className="text-muted-foreground">
              {placeholder || t('date')}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align={align}
        dir={dir}
      >
        <Calendar
          mode="single"
          locale={localeFor(i18n?.language)}
          selected={selected ?? undefined}
          onSelect={handleSelect}
          disabled={disabledMatcher}
          initialFocus
        />
        {allowClear && display && (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={handleClear}
            >
              {t('clearDate')}
            </Button>
          </div>
        )}
      </PopoverContent>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={normalized}
          required={required}
          onChange={() => {}}
        />
      ) : null}
    </Popover>
  );
}
