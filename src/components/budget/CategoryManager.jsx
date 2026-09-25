import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Archive, RotateCcw, Shapes } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';
import { logAppError, getUserFriendlyMessage } from '@/lib/userErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import EmptyState from '@/components/shared/EmptyState';
import CategoryIconPicker from '@/components/budget/CategoryIconPicker';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { getBudgetCategoryIcon, DEFAULT_CATEGORY_ICON } from '@/lib/budgetCategoryIcons';
import { toast } from 'sonner';

function emptyCategory(parentId = null) {
  return { name: '', description: '', icon: DEFAULT_CATEGORY_ICON, parent_category_id: parentId, sort_order: '0' };
}

export default function CategoryManager({ categories, onChanged, onAudit }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState(emptyCategory());
  const [saving, setSaving] = React.useState(false);

  const tops = (categories || []).filter((c) => !c.parent_category_id);
  const childrenOf = (id) => (categories || []).filter((c) => c.parent_category_id === id);
  // Collapsed by default; local state only (resets on remount).
  const [expanded, setExpanded] = React.useState([]);

  function openCreate(parentId = null) {
    setEditing(null);
    setForm(emptyCategory(parentId));
    setShowForm(true);
  }

  function openEdit(cat) {
    setEditing(cat);
    setForm({
      name: cat.name || '',
      description: cat.description || '',
      icon: cat.icon || '',
      parent_category_id: cat.parent_category_id,
      sort_order: cat.sort_order ?? '0',
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error(t('categoryNameRequired') || 'Please enter a category name.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        icon: form.icon?.trim() || null,
        parent_category_id: form.parent_category_id || null,
        sort_order: Number(form.sort_order) || 0,
      };
      if (editing) {
        const { error } = await supabase.from('budget_categories').update(payload).eq('id', editing.id);
        if (error) throw error;
        await onAudit('CATEGORY_UPDATED', 'Budget category updated', { id: editing.id, name: payload.name });
      } else {
        const { error } = await supabase.from('budget_categories').insert({ ...payload, created_by: user?.id || null });
        if (error) throw error;
        await onAudit('CATEGORY_CREATED', 'Budget category created', { name: payload.name });
      }
      toast.success(t('save') || 'Save');
      setShowForm(false);
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'save-category' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveCategory'));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(cat, active) {
    try {
      const { error } = await supabase.from('budget_categories').update({ active }).eq('id', cat.id);
      if (error) throw error;
      await onAudit(active ? 'CATEGORY_UPDATED' : 'CATEGORY_ARCHIVED', `Budget category ${active ? 'restored' : 'archived'}`, { id: cat.id, name: cat.name });
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'archive-category' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveCategory'));
    }
  }

  function renderRow(cat, depth = 0) {
    const Icon = getBudgetCategoryIcon(cat.icon);
    // Row actions stop propagation so clicks inside an accordion trigger
    // never toggle the parent while editing, adding or (un)archiving.
    const stop = (e) => e.stopPropagation();
    return (
      <div className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2">
        <span aria-hidden className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{cat.name}</p>
          {cat.description && <p className="text-xs text-muted-foreground truncate">{cat.description}</p>}
        </div>
        {!cat.active && (
          <Badge variant="outline" className="text-[10px]">{t('archived', 'Archived')}</Badge>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { stop(e); openEdit(cat); }} aria-label={`${t('edit') || 'Edit'}: ${cat.name}`}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        {depth === 0 && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { stop(e); openCreate(cat.id); }} aria-label={`${t('subcategoryNew', 'New subcategory')} (${cat.name})`} title={t('subcategoryNew', 'New subcategory')}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
        {cat.active ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { stop(e); handleArchive(cat, false); }} aria-label={`${t('archive') || 'Archive'}: ${cat.name}`}>
            <Archive className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { stop(e); handleArchive(cat, true); }} aria-label={`${t('restore') || 'Restore'}: ${cat.name}`}>
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    );
  }

  function renderCategory(cat, depth = 0) {
    // Top-level parents with children collapse into an accordion (collapsed
    // by default); leaf rows and nested children render inline as before.
    if (depth > 0) {
      return (
        <div key={cat.id}>
          {renderRow(cat, depth)}
        </div>
      );
    }
    const children = childrenOf(cat.id);
    if (children.length === 0) {
      return (
        <div key={cat.id}>
          {renderRow(cat, depth)}
        </div>
      );
    }
    return (
      <AccordionItem key={cat.id} value={cat.id} className="border-b-0">
        <AccordionTrigger className="py-0 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring rounded-lg [&>svg]:ml-1">
          <span className="flex-1 min-w-0 text-left">
            {renderRow(cat, depth)}
          </span>
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {children.length}
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-1">
          <div className="ml-4 sm:ml-8 border-l-2 border-border pl-3 mt-1.5 space-y-1.5">
            {children.map((child) => renderCategory(child, depth + 1))}
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => openCreate(null)}>
          <Plus className="w-4 h-4" /> {t('categoryNew', 'New category')}
        </Button>
      </div>
      {tops.length === 0 ? (
        <EmptyState icon={Shapes} title={t('categoryEmpty', 'No categories yet')} description={t('categoryEmptyHint', 'Create categories to organize spending.')} />
      ) : (
        <Accordion type="multiple" value={expanded} onValueChange={setExpanded} className="space-y-2">
          {tops.map((cat) => renderCategory(cat))}
        </Accordion>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editing ? (t('categoryEdit', 'Edit category')) : form.parent_category_id ? (t('subcategoryNew', 'New subcategory')) : (t('categoryNew', 'New category'))}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>{t('categoryName', 'Name')} *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></div>
            <div><Label>{t('description', 'Description')}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={300} /></div>
            <CategoryIconPicker id="category-icon" value={form.icon} onChange={(v) => setForm({ ...form, icon: v })} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('categoryParent', 'Parent category')}</Label>
                <Select value={form.parent_category_id || 'none'} onValueChange={(v) => setForm({ ...form, parent_category_id: v === 'none' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {tops.filter((c) => c.id !== editing?.id).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('categoryOrder', 'Order')}</Label>
                <Input type="number" step="1" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
