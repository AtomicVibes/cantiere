import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/inputWithIcon';
import DatePicker from '@/components/ui/DatePicker';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import EventColorPicker from '@/components/events/EventColorPicker';
import EventTypeDialog from '@/components/events/EventTypeDialog';
import {
  APP_ACCENT_FALLBACK,
  getAppAccentColor,
  getEffectiveEventColor,
  getEventHexColorName,
  isValidHexColor,
} from '@/lib/eventColors';
import {
  coerceReminderFormOnFrequencyChange,
  normalizeEventReminder,
} from '@/lib/eventReminders';
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Lock, Globe, Users, Folder, Trash2, Archive, Check, Bell } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isAfter, startOfDay } from 'date-fns';

const emptyEvent = { title: '', description: '', type: 'other', event_type_id: null, event_color: null, date: '', time: '', location: '', visibility: 'private', project_id: 'none', reminder_frequency: '24_hours', reminder_interval_value: '', reminder_interval_unit: 'hours' };

// Value used by the type selector to open the "create new event type" dialog.
const CREATE_NEW_TYPE_VALUE = '__create_new_type__';

const toPgTime = (t) => {
  if (!t) return null;
  return t.length === 5 ? `${t}:00` : t;
};

const fromPgTime = (t) => (t ? t.slice(0, 5) : '');

const EVENT_TYPES_BASE = [
  { value: 'deadline',      label: 'Deadline',      color: 'bg-red-500' },
  { value: 'meeting',       label: 'Meeting',       color: 'bg-blue-500' },
  { value: 'site_visit',    label: 'Site Visit',    color: 'bg-emerald-500' },
  { value: 'inspection',    label: 'Inspection',    color: 'bg-purple-500' },
  { value: 'permit_expiry', label: 'Permit Expiry', color: 'bg-amber-500' },
  { value: 'payment_due',   label: 'Payment Due',   color: 'bg-indigo-500' },
];

export default function CalendarPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  
  const EVENT_TYPES = React.useMemo(
    () => [
      ...EVENT_TYPES_BASE,
      { value: 'other', label: t('other') || 'Other', color: 'bg-slate-500' },
    ],
    [t]
  );

  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEvent);
  const [selectedAudience, setSelectedAudience] = useState([]);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showTypeDialog, setShowTypeDialog] = useState(false);
  const [accentColor, setAccentColor] = useState(APP_ACCENT_FALLBACK);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    setAccentColor(getAppAccentColor());
  }, []);

  const { data: events = [], isLoading, isError, error } = useQuery({
    queryKey: ['calendarEvents', currentUser?.id],
    enabled: !!currentUser,
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          project:projects ( id, name )
        `)
        .eq('archived', false)
        .order('date', { ascending: true })
        .order('time', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projectsList'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Database-backed custom event types. When the migration has not been
  // applied yet (or RLS denies access), fall back to an empty list so legacy
  // string types keep working.
  const { data: eventTypes = [] } = useQuery({
    queryKey: ['eventTypes'],
    enabled: !!currentUser,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('event_types')
          .select('id, name, color')
          .eq('archived', false)
          .order('name', { ascending: true });
        if (error) throw error;
        return data ?? [];
      } catch (err) {
        console.warn('[CalendarPage] event_types unavailable, using legacy types:', err?.message);
        return [];
      }
    },
  });

  const eventTypeById = React.useMemo(
    () => new Map((eventTypes || []).map((et) => [et.id, et])),
    [eventTypes]
  );

  // Combined selector options: legacy string types first (backward compat),
  // then database-backed custom types not already covered by legacy values.
  const typeOptions = React.useMemo(() => {
    const legacyValues = new Set(EVENT_TYPES.map((o) => o.value));
    const customs = (eventTypes || [])
      .filter((et) => et && et.id && et.name && !legacyValues.has(et.name))
      .map((et) => ({
        key: `id:${et.id}`,
        selectValue: `id:${et.id}`,
        label: et.name,
        hex: getEffectiveEventColor(
          { type: et.name, event_color: null },
          et,
          accentColor
        ),
        custom: et,
      }));
    const legacy = EVENT_TYPES.map((o) => ({
      key: `type:${o.value}`,
      selectValue: `type:${o.value}`,
      label: o.label,
      hex: getEffectiveEventColor(
        { type: o.value, event_color: null },
        (eventTypes || []).find((et) => et.name === o.value) ?? null,
        accentColor
      ),
      legacyValue: o.value,
    }));
    return [...legacy, ...customs];
  }, [EVENT_TYPES, eventTypes, accentColor]);

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembersAudience'],
    queryFn: async () => {
      const { data: members, error: memErr } = await supabase
        .from('team_members')
        .select('user_id, full_name, job_title, department, status')
        .eq('status', 'active');
      if (memErr) throw memErr;

      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, role');
      if (profErr) throw profErr;

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const combined = (members || [])
        .filter(m => m.user_id)
        .map(m => {
          const prof = profileMap.get(m.user_id) || {};
          return {
            user_id: m.user_id,
            full_name: m.full_name || prof.full_name || prof.email || 'Team Member',
            job_title: m.job_title || prof.role || '',
            department: m.department || '',
          };
        });

      const existingUserIds = new Set(combined.map(c => c.user_id));
      for (const p of (profiles || [])) {
        if (p.id && !existingUserIds.has(p.id)) {
          combined.push({
            user_id: p.id,
            full_name: p.full_name || p.email || 'User',
            job_title: p.role || '',
            department: '',
          });
        }
      }

      const unique = Array.from(new Map(combined.map(item => [item.user_id, item])).values());
      return unique.filter(m => !!m.user_id);
    },
  });

  const { data: eventAudienceList = [] } = useQuery({
    queryKey: ['eventAudience', selectedEvent?.id],
    enabled: !!selectedEvent && selectedEvent.visibility === 'selected',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_audience')
        .select('user_id')
        .eq('event_id', selectedEvent.id);
      if (error) throw error;
      const userIds = (data || []).map(d => d.user_id);
      if (userIds.length === 0) return [];

      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      return profs || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.visibility === 'selected' && selectedAudience.length === 0) {
        throw new Error('Please select at least one audience member for selected visibility.');
      }

      const row = {
        title: payload.title?.trim(),
        description: payload.description ? payload.description.trim().slice(0, 150) : null,
        type: payload.type || 'other',
        date: payload.date,
        time: toPgTime(payload.time),
        location: payload.location?.trim() || null,
        visibility: payload.visibility || 'private',
        project_id: payload.project_id && payload.project_id !== 'none' ? payload.project_id : null,
      };

      if (!row.time) {
        throw new Error('Time is required');
      }

      const { data: newEvent, error } = await supabase.rpc('create_event_with_audience', {
        p_title: row.title,
        p_description: row.description,
        p_type: row.type,
        p_date: row.date,
        p_time: row.time,
        p_location: row.location,
        p_visibility: row.visibility,
        p_project_id: row.project_id,
        p_audience_user_ids: selectedAudience,
      });

      if (error) throw error;
      if (!newEvent) throw new Error('Event was not returned after saving');

      // Persist reminder fields plus the additive custom type/color columns.
      // Reminder values are normalized to the events_reminder_frequency_check
      // contract (non-custom => NULL/NULL intervals; custom => positive int +
      // valid unit). If the colors migration has not been applied yet, retry
      // without the new columns so event creation keeps working on legacy DBs.
      const fullRow = {
        ...normalizeEventReminder({
          frequency: payload.reminder_frequency,
          value: payload.reminder_interval_value,
          unit: payload.reminder_interval_unit,
        }),
        event_type_id: payload.event_type_id || null,
        event_color:
          typeof payload.event_color === 'string' && isValidHexColor(payload.event_color)
            ? payload.event_color.trim().toUpperCase()
            : null,
      };
      const { error: reminderError } = await supabase
        .from('events')
        .update(fullRow)
        .eq('id', newEvent.id);
      if (reminderError) {
        const msg = reminderError.message || '';
        if (/event_color|event_type_id|event_types/i.test(msg)) {
          const { error: legacyError } = await supabase
            .from('events')
            .update({
              reminder_frequency: fullRow.reminder_frequency,
              reminder_interval_value: fullRow.reminder_interval_value,
              reminder_interval_unit: fullRow.reminder_interval_unit,
            })
            .eq('id', newEvent.id);
          if (legacyError) throw legacyError;
        } else {
          throw reminderError;
        }
      }

      return newEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', currentUser?.id] });
      setShowForm(false);
      setForm(emptyEvent);
      setEditingEvent(null);
      setSelectedAudience([]);
    },
    onError: (err) => {
      console.error('[CalendarPage] create error:', err);
      alert(`Could not save event: ${err.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const fullRow = {
        title: payload.title?.trim(),
        description: payload.description ? payload.description.trim().slice(0, 150) : null,
        type: payload.type || 'other',
        date: payload.date,
        time: toPgTime(payload.time),
        location: payload.location?.trim() || null,
        visibility: payload.visibility || 'private',
        project_id: payload.project_id && payload.project_id !== 'none' ? payload.project_id : null,
        ...normalizeEventReminder({
          frequency: payload.reminder_frequency,
          value: payload.reminder_interval_value,
          unit: payload.reminder_interval_unit,
        }),
        event_type_id: payload.event_type_id || null,
        event_color:
          typeof payload.event_color === 'string' && isValidHexColor(payload.event_color)
            ? payload.event_color.trim().toUpperCase()
            : null,
      };
      if (!fullRow.time) throw new Error('Time is required');
      const { data, error } = await supabase
        .from('events')
        .update(fullRow)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        const msg = error.message || '';
        if (/event_color|event_type_id|event_types/i.test(msg)) {
          const { event_color: _c, event_type_id: _t, ...legacyRow } = fullRow;
          const { data: legacyData, error: legacyError } = await supabase
            .from('events')
            .update(legacyRow)
            .eq('id', id)
            .select()
            .single();
          if (legacyError) throw legacyError;
          return legacyData;
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', currentUser?.id] });
      setShowForm(false);
      setForm(emptyEvent);
      setEditingEvent(null);
      setSelectedAudience([]);
      setSelectedEvent(null);
    },
    onError: (err) => {
      console.error('[CalendarPage] update error:', err);
      alert(`Could not save event: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', currentUser?.id] });
      setShowDeleteDialog(false);
      setSelectedEvent(null);
    },
    onError: (err) => {
      console.error('[CalendarPage] delete error:', err);
      alert(`Could not delete event: ${err.message}`);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }) => {
      const { data, error } = await supabase
        .from('events')
        .update({ archived })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', currentUser?.id] });
      setSelectedEvent(null);
    },
    onError: (err) => {
      console.error('[CalendarPage] archive error:', err);
      alert(`Could not update archive status: ${err.message}`);
    },
  });

  const monthStart = React.useMemo(() => startOfMonth(currentDate), [currentDate]);
  const monthEnd = React.useMemo(() => endOfMonth(currentDate), [currentDate]);
  const calStart = React.useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const calEnd = React.useMemo(() => endOfWeek(monthEnd, { weekStartsOn: 1 }), [monthEnd]);
  const days = React.useMemo(
    () => eachDayOfInterval({ start: calStart, end: calEnd }),
    [calStart, calEnd]
  );

  const getEventsForDay = (day) => events.filter(e => e.date && isSameDay(new Date(e.date), day));

  // Single authoritative color path: event_color -> event type color ->
  // legacy built-in default -> current application accent.
  const getEffectiveHex = React.useCallback(
    (ev) => {
      if (!ev) return accentColor;
      const typeRecord = ev.event_type_id ? eventTypeById.get(ev.event_type_id) ?? null : null;
      return getEffectiveEventColor(ev, typeRecord ?? ev.event_type ?? null, accentColor);
    },
    [eventTypeById, accentColor]
  );

  // Legacy adapter (kept for backward compatibility): resolves a bare legacy
  // `type` string through the same effective-color path. Prefer getEffectiveHex
  // for full event objects so stored overrides and type defaults apply.
  const getEventColor = (type) =>
    getEffectiveEventColor({ type, event_color: null }, null, accentColor);

  const getEventLabel = (type) => {
    const custom = (eventTypes || []).find((et) => et.name === type);
    if (custom) return custom.name;
    return EVENT_TYPES.find((o) => o.value === type)?.label || type;
  };

  const getEventColorName = (ev) => getEventHexColorName(getEffectiveHex(ev), t);

  // Select value for the type control: custom types by id, legacy by name.
  const formTypeSelectValue = form.event_type_id
    ? `id:${form.event_type_id}`
    : `type:${form.type || 'other'}`;

  // Changing the Event Type must NOT erase an intentional event-specific
  // color override: only `event_type_id`/`type` change here.
  const handleTypeSelect = (v) => {
    if (v === CREATE_NEW_TYPE_VALUE) {
      setShowTypeDialog(true);
      return;
    }
    if (typeof v === 'string' && v.startsWith('id:')) {
      const id = v.slice(3);
      const found = eventTypeById.get(id);
      if (found) {
        setForm((f) => ({ ...f, type: found.name, event_type_id: found.id }));
        return;
      }
    }
    if (typeof v === 'string' && v.startsWith('type:')) {
      const legacyValue = v.slice(5);
      const backfilled = (eventTypes || []).find((et) => et.name === legacyValue);
      setForm((f) => ({
        ...f,
        type: legacyValue,
        event_type_id: backfilled ? backfilled.id : null,
      }));
      return;
    }
    setForm((f) => ({ ...f, type: v }));
  };

  const handleNewTypeCreated = (newType) => {
    if (!newType) return;
    queryClient.invalidateQueries({ queryKey: ['eventTypes'] });
    // Select the freshly created type; its stored color becomes the default.
    // A missing event_color means the effective color resolves to it.
    setForm((f) => ({ ...f, type: newType.name, event_type_id: newType.id, event_color: null }));
  };

  const openCreateForm = (dateStr) => {
    setEditingEvent(null);
    setForm({ ...emptyEvent, date: dateStr || '' });
    setSelectedAudience([]);
    setShowForm(true);
  };

  const openEditForm = (ev) => {
    if (!ev) return;
    setEditingEvent(ev);
    setForm({
      ...emptyEvent,
      title: ev.title || '',
      description: ev.description || '',
      type: ev.type || 'other',
      event_type_id: ev.event_type_id || null,
      event_color:
        typeof ev.event_color === 'string' && isValidHexColor(ev.event_color)
          ? ev.event_color.trim().toUpperCase()
          : null,
      date: ev.date || '',
      time: fromPgTime(ev.time),
      location: ev.location || '',
      visibility: ev.visibility || 'private',
      project_id: ev.project_id || 'none',
      reminder_frequency: ev.reminder_frequency || '24_hours',
      reminder_interval_value: ev.reminder_interval_value ?? '',
      reminder_interval_unit: ev.reminder_interval_unit || 'hours',
    });
    setSelectedAudience([]);
    setShowForm(true);
  };

  const panelEvents = React.useMemo(() => {
    const today = startOfDay(new Date());
    if (selectedDate) {
      return events
        .filter(e => e.date && isSameDay(new Date(e.date), selectedDate))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    } else {
      return events
        .filter(e => {
          if (!e.date) return false;
          const d = startOfDay(new Date(e.date));
          return isSameDay(d, today) || isAfter(d, today);
        })
        .slice(0, 20);
    }
  }, [events, selectedDate]);

  const filteredTeamMembers = React.useMemo(() => {
    return teamMembers
      .filter(m => m && m.user_id)
      .filter(m => 
        (m.full_name || '').toLowerCase().includes(audienceSearch.toLowerCase()) ||
        (m.job_title || '').toLowerCase().includes(audienceSearch.toLowerCase()) ||
        (m.department || '').toLowerCase().includes(audienceSearch.toLowerCase())
      );
  }, [teamMembers, audienceSearch]);

  const handleDayClick = (day) => {
    setSelectedDate(day);
    setEditingEvent(null);
    setForm({ ...emptyEvent, date: format(day, 'yyyy-MM-dd') });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingEvent?.id) {
        await updateMutation.mutateAsync({ id: editingEvent.id, payload: form });
      } else {
        await createMutation.mutateAsync(form);
      }
    } finally {
      setSaving(false);
    }
  };

  const isOwner = selectedEvent && currentUser && selectedEvent.user_id === currentUser.id;

  return (
    <div>
      <TopBar title={t('calendar') || 'Calendar'} />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row w-full items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <h2 className="text-xl font-heading font-bold text-center">
              {format(currentDate, 'MMMM yyyy')}
            </h2>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
          <Button onClick={() => openCreateForm(selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '')} className="gap-2 w-full md:w-auto">
            <Plus className="w-4 h-4" /> {t('addEvent') || 'Add Event'}
          </Button>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid (Left: 2 cols) */}
          <div className="lg:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <div key={d} className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const dayEvents = getEventsForDay(day);
                const isToday = isSameDay(day, new Date());
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const inMonth = isSameMonth(day, currentDate);
                return (
                  <div
                    key={i}
                    className={cn(
                      "min-h-[100px] p-2 border-b border-r border-border cursor-pointer hover:bg-muted/50 transition-colors relative",
                      !inMonth && "opacity-40",
                      isSelected && "bg-primary/10 ring-1 ring-primary ring-inset"
                    )}
                    onClick={() => handleDayClick(day)}
                  >
                    <span className={cn(
                      "text-sm font-medium inline-flex items-center justify-center w-7 h-7 rounded-full",
                      isToday && "bg-primary text-primary-foreground"
                    )}>
                      {format(day, 'd')}
                    </span>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 3).map(ev => (
                        <div key={ev.id} className="flex items-center gap-1">
                          <div
                            aria-hidden
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: getEffectiveHex(ev) }}
                          />
                          <span className="text-xs truncate">{ev.title}</span>
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-xs text-muted-foreground">+{dayEvents.length - 3} {t('more') || 'more'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Events Sub-Window (Right: 1 col) */}
          <div className="lg:col-span-1 bg-card rounded-xl border border-border flex flex-col overflow-hidden">
            {/* Panel Header */}
            <div className="bg-accent px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-heading font-semibold text-sm text-accent-foreground">
                {selectedDate ? format(selectedDate, 'EEEE, d MMM') : (t('upcomingEvents') || 'Upcoming Events')}
              </h3>
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate(null)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  {t('showAllUpcoming') || 'Show all upcoming'}
                </button>
              )}
            </div>

            {/* Sub-header info */}
            <div className="px-4 py-2 border-b border-border bg-card text-xs text-muted-foreground flex justify-between items-center">
              <span>{panelEvents.length} {panelEvents.length === 1 ? 'event' : 'events'}</span>
              {selectedDate && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-primary hover:bg-primary/10"
                  onClick={() => openCreateForm(format(selectedDate, 'yyyy-MM-dd'))}
                >
                  <Plus className="w-3 h-3 mr-1" /> {t('addEvent') || 'Add Event'}
                </Button>
              )}
            </div>

            {/* Scrollable Event List */}
            <div className="p-3 space-y-2 overflow-y-auto max-h-[580px]">
              {isLoading && (
                <div className="text-center py-12 text-sm text-muted-foreground">{t('loading') || 'Loading…'}</div>
              )}

              {isError && (
                <div className="text-center py-12 text-sm text-destructive">
                  {error?.message || t('errorLoadingEvents') || 'Unable to load events.'}
                </div>
              )}

              {!isLoading && !isError && panelEvents.length === 0 && (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {selectedDate ? (t('noEventsOnThisDay') || 'No events on this day.') : (t('noUpcomingEvents') || 'No upcoming events.')}
                </div>
              )}

              {!isLoading && panelEvents.map(ev => {
                const isPublic = ev.visibility === 'public';
                const isSelectedAudience = ev.visibility === 'selected';
                const isPrivate = !isPublic && !isSelectedAudience;
                return (
                  <button
                    key={ev.id}
                    onClick={() => setSelectedEvent(ev)}
                    className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary space-y-2 group relative"
                  >
                    <div className="absolute top-3 right-3">
                      {isPublic && <Globe className="w-4 h-4 text-primary" title={t('public') || 'Public'} />}
                      {isSelectedAudience && <Users className="w-4 h-4 text-muted-foreground" title={t('selectedAudience') || 'Selected Audience'} />}
                      {isPrivate && <Lock className="w-4 h-4 text-muted-foreground" title={t('private') || 'Private'} />}
                    </div>

                    <div className="flex items-start justify-between gap-2 pr-6">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          aria-hidden
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getEffectiveHex(ev) }}
                        />
                        <h4 className="font-medium text-sm text-foreground truncate group-hover:text-foreground">{ev.title}</h4>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {ev.time && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {fromPgTime(ev.time)}
                        </span>
                      )}
                      {ev.date && (
                        <span>{format(new Date(ev.date), 'MMM d, yyyy')}</span>
                      )}
                    </div>

                    {ev.project?.name && (
                      <div className="flex items-center gap-1 text-xs text-primary font-medium truncate">
                        <Folder className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{ev.project.name}</span>
                      </div>
                    )}

                    {ev.location && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{ev.location}</span>
                      </div>
                    )}

                    {ev.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{ev.description}</p>
                    )}

                    <div className="pt-1">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground uppercase tracking-wider">
                        {getEventLabel(ev.type)}
                      </span>
                      <span className="ms-1 text-[10px] text-muted-foreground">
                        {getEventColorName(ev)}
                      </span>
                      {ev.reminder_display && ev.reminder_frequency !== 'disabled' && (
                        <span
                          title={ev.reminder_display}
                          aria-label={ev.reminder_display}
                          className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20"
                        >
                          <Bell className="w-3 h-3" />
                          {ev.reminder_short}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Event Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) setEditingEvent(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">{editingEvent ? (t('editEvent') || 'Edit Event') : (t('newEvent') || 'New Event')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div><Label>{t('title') || 'Title'} *</Label><Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
            
            <div>
              <Label>{t('description') || 'Description'}</Label>
              <Textarea 
                value={form.description} 
                onChange={e => setForm({...form, description: e.target.value.slice(0, 150)})} 
                maxLength={150}
                rows={2} 
              />
              <span className="text-xs text-muted-foreground">{form.description.length}/150</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{t('eventColors.eventType', 'Event Type')}</Label>
                <div className="flex items-center gap-2">
                  <Select value={formTypeSelectValue} onValueChange={handleTypeSelect}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((o) => (
                        <SelectItem key={o.key} value={o.selectValue}>
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                              style={{ backgroundColor: o.hex }}
                            />
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value={CREATE_NEW_TYPE_VALUE}>
                        + {t('eventColors.createNewEventType', 'Create new event type')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <span
                    aria-hidden
                    className="w-5 h-5 rounded-full flex-shrink-0 border border-border"
                    style={{
                      backgroundColor: getEffectiveEventColor(
                        { type: form.type, event_color: form.event_color },
                        form.event_type_id ? eventTypeById.get(form.event_type_id) ?? null : (eventTypes || []).find((et) => et.name === form.type) ?? null,
                        accentColor
                      ),
                    }}
                  />
                </div>
              </div>
              <div><Label>{t('date') || 'Date'} *</Label><DatePicker value={form.date} onChange={v => setForm({ ...form, date: v })} /></div>
            </div>

            <div className="space-y-2">
              <Label>{t('eventColors.eventColor', 'Event color')}</Label>
              <EventColorPicker
                id="event-form-color"
                value={form.event_color}
                onChange={(hex) => setForm((f) => ({ ...f, event_color: hex }))}
                accentColor={accentColor}
              />
              {form.event_color && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-primary"
                  onClick={() => setForm((f) => ({ ...f, event_color: null }))}
                >
                  {t('eventColors.useTypeDefault', 'Use type default')}
                </Button>
              )}
              {!form.event_color && (
                <p className="text-xs text-muted-foreground">
                  {t('eventColors.usingTypeDefault', 'Using the event type default color.')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>{t('time') || 'Time'} *</Label><TimeInput value={form.time} onChange={e => setForm({...form, time: e.target.value})} required /></div>
              <div><Label>{t('location') || 'Location'}</Label><Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            </div>

            {/* Visibility Scope */}
            <div className="space-y-2">
              <Label>{t('visibility.label') || 'Visibility'}</Label>
              <Select 
                value={form.visibility} 
                onValueChange={v => {
                  setForm({...form, visibility: v});
                  if (v !== 'selected') setSelectedAudience([]);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{t('visibility.private') || 'Private'}</SelectItem>
                  <SelectItem value="public">{t('visibility.public') || 'Public'}</SelectItem>
                  <SelectItem value="selected">{t('visibility.selected') || 'Selected Audience'}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.visibility === 'private' && (t('privateHelp') || 'Only you can see this event')}
                {form.visibility === 'public' && (t('publicHelp') || 'All authenticated users can see this event')}
                {form.visibility === 'selected' && (t('selectedHelp') || 'Only the audience you select can see this event')}
              </p>
            </div>

            {/* Event Reminder */}
            <div className="space-y-2">
              <Label>{t('reminder.section') || 'Event Reminder'}</Label>
              <Select value={form.reminder_frequency || '24_hours'} onValueChange={v => {
                setForm((f) => coerceReminderFormOnFrequencyChange(f, v));
              }}>
                <SelectTrigger><SelectValue placeholder={t('reminder.frequency') || 'Reminder'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">{t('reminder.noReminder') || 'No reminder'}</SelectItem>
                  <SelectItem value="30_minutes">{t('reminder.30_minutes') || '30 minutes before'}</SelectItem>
                  <SelectItem value="1_hour">{t('reminder.1_hour') || '1 hour before'}</SelectItem>
                  <SelectItem value="24_hours">{t('reminder.24_hours') || '24 hours before'}</SelectItem>
                  <SelectItem value="weekly">{t('reminder.weekly') || '1 week before'}</SelectItem>
                  <SelectItem value="monthly">{t('reminder.monthly') || '1 month before'}</SelectItem>
                  <SelectItem value="custom">{t('reminder.custom') || 'Custom'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.reminder_frequency === 'custom' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t('reminder.value') || 'Value'}</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={form.reminder_interval_value ?? ''}
                    onChange={e => setForm({ ...form, reminder_interval_value: e.target.value })}
                    aria-label={t('reminder.value') || 'Reminder value'}
                    aria-invalid={form.reminder_interval_value !== undefined && Number(form.reminder_interval_value) <= 0}
                  />
                  {form.reminder_interval_value !== undefined && Number(form.reminder_interval_value) <= 0 && (
                    <p className="text-xs text-destructive mt-1">{t('reminder.mustBePositive') || 'Reminder value must be greater than zero'}</p>
                  )}
                </div>
                <div>
                  <Label>{t('reminder.unit') || 'Unit'}</Label>
                  <Select value={form.reminder_interval_unit || 'hours'} onValueChange={v => setForm({ ...form, reminder_interval_unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">{t('reminder.unitMinutes') || 'Minutes'}</SelectItem>
                      <SelectItem value="hours">{t('reminder.unitHours') || 'Hours'}</SelectItem>
                      <SelectItem value="days">{t('reminder.unitDays') || 'Days'}</SelectItem>
                      <SelectItem value="weeks">{t('reminder.unitWeeks') || 'Weeks'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Audience Picker (if visibility === 'selected') */}
            {form.visibility === 'selected' && (
              <div className="space-y-2 p-3 rounded-lg border border-border bg-card">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-semibold">{t('selectAudience') || 'Select Audience'} *</Label>
                  <span className="text-xs text-primary font-medium">{selectedAudience.length} {t('selected') || 'selected'}</span>
                </div>
                <Input
                  placeholder={t('searchTeamMembers') || 'Search team members...'}
                  value={audienceSearch}
                  onChange={e => setAudienceSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                <div className="max-h-[160px] overflow-y-auto space-y-1.5 pt-1">
                  {filteredTeamMembers.map(member => {
                    const isChecked = selectedAudience.includes(member.user_id);
                    return (
                      <div
                        key={member.user_id}
                        onClick={() => {
                          setSelectedAudience(prev => 
                            isChecked ? prev.filter(id => id !== member.user_id) : [...prev, member.user_id]
                          );
                        }}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-xs",
                          isChecked ? "bg-primary/10 border border-primary/30" : "hover:bg-muted"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                          isChecked ? "bg-primary border-primary" : "border-input"
                        )}>
                          {isChecked && <Check className="w-3 h-3 text-primary-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">{member.full_name}</p>
                          {member.job_title && <p className="text-[10px] text-muted-foreground truncate">{member.job_title}</p>}
                        </div>
                      </div>
                    );
                  })}
                  {filteredTeamMembers.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">{t('noTeamMembersFound') || 'No team members found.'}</p>
                  )}
                </div>
                {form.visibility === 'selected' && selectedAudience.length === 0 && (
                  <p className="text-[10px] text-destructive font-medium">{t('audienceRequired') || 'Please select at least one audience member.'}</p>
                )}
              </div>
            )}

            {/* Project Assignment */}
            <div className="space-y-2">
              <Label>{t('assignToProject') || 'Assign to project'}</Label>
              <Select value={form.project_id} onValueChange={v => setForm({...form, project_id: v})}>
                <SelectTrigger><SelectValue placeholder={t('selectProject') || 'Select project (optional)'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none') || 'None'}</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel') || 'Cancel'}</Button>
              <Button type="submit" disabled={saving || !form.title || !form.date || !form.time || (form.visibility === 'selected' && selectedAudience.length === 0)}>
                {saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Event Detail Dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        {selectedEvent && (
          <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0">
            <DialogHeader className="p-6 pb-2">
              <DialogTitle className="font-heading flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    aria-hidden
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: selectedEvent ? getEffectiveHex(selectedEvent) : accentColor }}
                  />
                  <span className="truncate">{selectedEvent.title}</span>
                </div>
              </DialogTitle>
            </DialogHeader>

            <div className="p-6 pt-2 space-y-4 text-sm overflow-y-auto flex-1">
              {/* Badges Row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-muted text-muted-foreground uppercase tracking-wider">
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: getEffectiveHex(selectedEvent) }}
                  />
                  {getEventLabel(selectedEvent.type)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {getEventColorName(selectedEvent)}
                </span>
                
                {selectedEvent.visibility === 'public' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-primary/10 text-primary">
                    <Globe className="w-3.5 h-3.5" /> {t('visibility.public') || 'Public'}
                  </span>
                )}
                {selectedEvent.visibility === 'selected' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-muted text-muted-foreground">
                    <Users className="w-3.5 h-3.5" /> {t('visibility.selected') || 'Selected Audience'}
                  </span>
                )}
                {(!selectedEvent.visibility || selectedEvent.visibility === 'private') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-muted text-muted-foreground">
                    <Lock className="w-3.5 h-3.5" /> {t('visibility.private') || 'Private'}
                  </span>
                )}
              </div>

              {selectedEvent.project?.name && (
                <div className="flex items-center gap-1.5 text-primary font-medium text-xs bg-primary/5 p-2 rounded-lg border border-primary/20">
                  <Folder className="w-4 h-4 flex-shrink-0" />
                  <span>{selectedEvent.project.name}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span>{selectedEvent.date ? format(new Date(selectedEvent.date), 'EEEE, MMMM d, yyyy') : ''}</span>
                  {selectedEvent.time && <span>at {fromPgTime(selectedEvent.time)}</span>}
                </div>
              </div>

              {selectedEvent.location && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span>{selectedEvent.location}</span>
                </div>
              )}

              {selectedEvent.description && (
                <div className="pt-2 border-t border-border">
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{t('description') || 'Description'}</h5>
                  <p className="text-foreground whitespace-pre-wrap text-sm">{selectedEvent.description}</p>
                </div>
              )}

              {/* Audience list if selected visibility */}
              {selectedEvent.visibility === 'selected' && (
                <div className="pt-2 border-t border-border space-y-1.5">
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase">{t('invitedAudience') || 'Invited Audience'} ({eventAudienceList.length})</h5>
                  <div className="max-h-[120px] overflow-y-auto space-y-1">
                    {eventAudienceList.map(aud => (
                      <div key={aud.id} className="text-xs bg-muted p-1.5 rounded flex justify-between items-center">
                        <span className="font-medium text-foreground">{aud.full_name || aud.email}</span>
                        <span className="text-[10px] text-muted-foreground">{aud.email}</span>
                      </div>
                    ))}
                    {eventAudienceList.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">{t('loadingAudience') || 'Loading audience...'}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="p-6 pt-3 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-between gap-2 bg-card">
              {isOwner ? (
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate({ id: selectedEvent.id, archived: !selectedEvent.archived })}
                >
                  <Archive className="w-4 h-4" />
                  {selectedEvent.archived ? (t('unarchive') || 'Unarchive') : (t('archive') || 'Archive')}
                </Button>
              ) : <div />}

              <div className="flex flex-col-reverse sm:flex-row gap-2">
                {isOwner && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      const ev = selectedEvent;
                      setSelectedEvent(null);
                      openEditForm(ev);
                    }}
                  >
                    {t('edit') || 'Edit'}
                  </Button>
                )}
                {isOwner && (
                  <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="gap-2">
                        <Trash2 className="w-4 h-4" />
                        {t('cancelEvent') || 'Cancel Event'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirmDeleteTitle') || 'Delete this event permanently?'}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('confirmDeleteDesc') || 'This action cannot be undone. The event and its audience list will be removed.'}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>{t('cancel') || 'Cancel'}</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={deleteMutation.isPending}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={(e) => {
                            e.preventDefault();
                            deleteMutation.mutate(selectedEvent.id);
                          }}
                        >
                          {deleteMutation.isPending ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button variant="outline" onClick={() => setSelectedEvent(null)}>
                  {t('close') || 'Close'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Create custom event type */}
      <EventTypeDialog
        open={showTypeDialog}
        onOpenChange={setShowTypeDialog}
        onCreated={handleNewTypeCreated}
        accentColor={accentColor}
      />
    </div>
  );
}
