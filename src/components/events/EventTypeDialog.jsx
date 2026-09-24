import React from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import EventColorPicker from '@/components/events/EventColorPicker';
import { getAppAccentColor } from '@/lib/eventColors';

// Dialog for creating a new database-backed event type (free-typed name +
// color). The default color is always the CURRENT application accent; once
// stored, the type keeps its color even if the accent later changes.
export default function EventTypeDialog({ open, onOpenChange, onCreated, accentColor }) {
  const { t } = useTranslation();
  const accent = accentColor || getAppAccentColor();
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(accent);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setColor(getAppAccentColor());
      setError(null);
    }
  }, [open]);

  const handleSave = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('eventColors.typeNameRequired', 'Type name is required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('event_types')
        .insert({ name: trimmed, color })
        .select()
        .single();
      if (insertError) throw insertError;
      onCreated?.(data);
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('eventColors.createTypeFailed', 'Could not create the event type.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {t('eventColors.createEventType', 'Create event type')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label htmlFor="new-event-type-name">
              {t('eventColors.typeName', 'Type name')} *
            </Label>
            <Input
              id="new-event-type-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('eventColors.typeNamePlaceholder', 'e.g. Workshop')}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>{t('eventColors.eventColor', 'Event color')}</Label>
            <EventColorPicker
              id="new-event-type-color"
              value={color}
              onChange={setColor}
              accentColor={accent}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive font-medium">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel') || 'Cancel'}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t('saving') || 'Saving...' : t('save') || 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
