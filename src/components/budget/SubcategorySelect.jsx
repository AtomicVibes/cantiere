import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';
import { logAppError, getUserFriendlyMessage } from '@/lib/userErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getBudgetCategoryIcon, DEFAULT_CATEGORY_ICON } from '@/lib/budgetCategoryIcons';
import CategoryIconPicker from '@/components/budget/CategoryIconPicker';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const CUSTOM_VALUE = '__create_custom__';

// Grouped, searchable subcategory dropdown with inline custom creation.
// Predefined rows resolve localized labels via subcat_<key>; custom rows
// (is_custom) display their stored name verbatim. Selecting "+ Create
// custom subcategory" reveals a name + parent + icon form that persists a
// new row and selects it. Parent context filters the list when provided.
export function subcategoryLabel(sub, t) {
  if (!sub) return '';
  if (sub.subcategory_key) return t(`subcat_${sub.subcategory_key}`, sub.name);
  return sub.name || '';
}

export default function SubcategorySelect({
  value,
  onChange,
  categories = [],
  parentCategoryId = null,
  disabled = false,
  onAudit,
  id = 'subcategory',
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [customName, setCustomName] = React.useState('');
  const [customParent, setCustomParent] = React.useState(null);
  const [customIcon, setCustomIcon] = React.useState(DEFAULT_CATEGORY_ICON);
  const [savingCustom, setSavingCustom] = React.useState(false);

  const parents = React.useMemo(
    () => (categories || []).filter((c) => !c.parent_category_id && c.active !== false),
    [categories]
  );
  const parentNameOf = React.useCallback(
    (sub) => (categories || []).find((c) => c.id === sub.parent_category_id)?.name || '',
    [categories]
  );

  const options = React.useMemo(() => {
    const subs = (categories || []).filter((c) => c.parent_category_id && c.active !== false);
    const scoped = parentCategoryId && parentCategoryId !== 'none'
      ? subs.filter((s) => s.parent_category_id === parentCategoryId)
      : subs;
    const q = query.trim().toLowerCase();
    const list = q
      ? scoped.filter((s) => subcategoryLabel(s, t).toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q))
      : scoped;
    const groups = new Map();
    for (const sub of list) {
      const parent = parentNameOf(sub) || t('subcategoryUngrouped', 'Other');
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(sub);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [categories, parentCategoryId, query, t, parentNameOf]);

  const selected = React.useMemo(
    () => (categories || []).find((c) => c.id === value),
    [categories, value]
  );
  const SelectedIcon = getBudgetCategoryIcon(selected?.icon);

  function beginCreate() {
    setCustomName(query.replace(/^\+?\s*/, '').trim());
    setCustomParent(parentCategoryId && parentCategoryId !== 'none' ? parentCategoryId : null);
    setCustomIcon(DEFAULT_CATEGORY_ICON);
    setCreating(true);
  }

  async function handleCreateCustom(e) {
    e?.preventDefault();
    const name = customName.trim();
    if (!name) {
      toast.error(t('customSubNameRequired') || 'Please enter a name.');
      return;
    }
    setSavingCustom(true);
    try {
      const { data, error } = await supabase
        .from('budget_categories')
        .insert({
          name,
          parent_category_id: customParent || null,
          icon: customIcon || DEFAULT_CATEGORY_ICON,
          is_custom: true,
          created_by: user?.id || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      await onAudit?.('CATEGORY_CREATED', 'Custom subcategory created', { id: data?.id, name });
      toast.success(t('save') || 'Save');
      setCreating(false);
      setCustomName('');
      setOpen(false);
      onChange(data?.id || null);
    } catch (err) {
      logAppError('Budget', err, { operation: 'create-custom-subcategory' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveCategory'));
    } finally {
      setSavingCustom(false);
    }
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setCreating(false); setQuery(''); } }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={t('subcategory', 'Subcategory')}
            className={cn('w-full justify-start font-normal', !selected && 'text-muted-foreground')}
          >
            {selected ? (
              <span className="flex items-center gap-2 truncate">
                <SelectedIcon aria-hidden className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{subcategoryLabel(selected, t)}</span>
              </span>
            ) : (
              <span>{t('selectSubcategory', 'Select subcategory')}</span>
            )}
            <ChevronDown aria-hidden className="ml-auto w-4 h-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start" sideOffset={4}>
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder={t('searchSubcategories', 'Search subcategories...')} className="h-10" />
            <CommandList className="max-h-56">
              <CommandEmpty>{t('subcategoryEmpty', 'No subcategories found.')}</CommandEmpty>
              {options.map(([parent, subs]) => (
                <CommandGroup key={parent} heading={parent}>
                  {subs.map((sub) => {
                    const Icon = getBudgetCategoryIcon(sub.icon);
                    const isSelected = value === sub.id;
                    return (
                      <CommandItem
                        key={sub.id}
                        value={sub.id}
                        onSelect={() => { onChange(sub.id); setOpen(false); setQuery(''); }}
                        className="gap-2"
                      >
                        <Icon aria-hidden className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{subcategoryLabel(sub, t)}</span>
                        {isSelected && <Check aria-hidden className="w-4 h-4 shrink-0 text-primary" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
              <CommandGroup>
                <CommandItem value={CUSTOM_VALUE} onSelect={beginCreate} className="gap-2 text-primary">
                  <Plus aria-hidden className="w-4 h-4 shrink-0" />
                  {t('createCustomSubcategory', 'Create custom subcategory')}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
          {creating && (
            <form onSubmit={handleCreateCustom} className="border-t border-border p-3 space-y-2">
              <div>
                <Label htmlFor={`${id}-custom-name`}>{t('customSubName', 'Custom subcategory name')} *</Label>
                <Input
                  id={`${id}-custom-name`}
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div>
                <Label>{t('categoryParent', 'Parent category')}</Label>
                <Select value={customParent || 'none'} onValueChange={(v) => setCustomParent(v === 'none' ? null : v)}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {parents.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <CategoryIconPicker id={`${id}-custom-icon`} value={customIcon} onChange={setCustomIcon} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={savingCustom}>
                  {savingCustom ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                </Button>
              </div>
            </form>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
