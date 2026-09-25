import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BUDGET_CATEGORY_ICON_IDS, getBudgetCategoryIcon } from '@/lib/budgetCategoryIcons';
import { cn } from '@/lib/utils';

// Searchable Lucide icon picker for budget categories. Stores only the
// stable registry id; previews come from the central registry.
export default function CategoryIconPicker({ value, onChange, id = 'category-icon' }) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUDGET_CATEGORY_ICON_IDS;
    return BUDGET_CATEGORY_ICON_IDS.filter((iconId) => iconId.toLowerCase().includes(q));
  }, [query]);

  const SelectedIcon = getBudgetCategoryIcon(value);

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-search`}>{t('categoryIcon', 'Icon')}</Label>
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-9 h-9 rounded-md border border-border bg-muted flex items-center justify-center shrink-0">
          <SelectedIcon className="w-4 h-4" />
        </span>
        <div className="relative flex-1">
          <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id={`${id}-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('iconSearch', 'Search icons...')}
            aria-label={t('iconSearch', 'Search icons...')}
            className="pl-9 h-8 text-xs"
          />
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={t('categoryIcon', 'Icon')}
        className="grid grid-cols-8 sm:grid-cols-10 gap-1 max-h-36 overflow-y-auto rounded-md border border-border p-2"
      >
        {filtered.map((iconId) => {
          const Icon = getBudgetCategoryIcon(iconId);
          const selected = value === iconId;
          return (
            <button
              key={iconId}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={iconId}
              title={iconId}
              onClick={() => onChange(iconId)}
              className={cn(
                'w-8 h-8 rounded-md flex items-center justify-center border transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon aria-hidden className="w-4 h-4" />
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full text-xs text-muted-foreground text-center py-3">
            {t('contactEmpty', 'No team members found.')}
          </p>
        )}
      </div>
    </div>
  );
}
