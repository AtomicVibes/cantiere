import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isAfter, startOfDay } from 'date-fns';

const emptyEvent = { title: '', description: '', type: 'other', date: '', time: '', location: '' };

const toPgTime = (t) => {
  if (!t) return null;
  return t.length === 5 ? `${t}:00` : t;
};

const fromPgTime = (t) => (t ? t.slice(0, 5) : '');

export default function CalendarPage() {
  const { t } = useTranslation();
  const EVENT_TYPES = [
    { value: 'deadline', label: 'Deadline', color: 'bg-red-500' },
    { value: 'meeting', label: 'Meeting', color: 'bg-blue-500' },
    { value: 'site_visit', label: 'Site Visit', color: 'bg-emerald-500' },
    { value: 'inspection', label: 'Inspection', color: 'bg-purple-500' },
    { value: 'permit_expiry', label: 'Permit Expiry', color: 'bg-amber-500' },
    { value: 'payment_due', label: 'Payment Due', color: 'bg-indigo-500' },
    { value: 'other', label: t('other'), color: 'bg-slate-500' },
  ];
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEvent);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const queryClient = useQueryClient();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendarEvents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true })
        .order('time', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        throw new Error('Not authenticated — cannot save event');
      }

      const row = {
        user_id: userData.user.id,
        title: payload.title?.trim(),
        description: payload.description ? payload.description.trim().slice(0, 150) : null,
        type: payload.type || 'other',
        date: payload.date,
        time: toPgTime(payload.time),
        location: payload.location?.trim() || null,
      };

      if (!row.time) {
        throw new Error('Time is required');
      }

      const { data, error } = await supabase
        .from('events')
        .insert(row)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      setShowForm(false);
      setForm(emptyEvent);
    },
    onError: (err) => {
      console.error('[CalendarPage] create error:', err);
      alert(`Could not save event: ${err.message}`);
    },
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const getEventsForDay = (day) => events.filter(e => e.date && isSameDay(new Date(e.date), day));
  const getEventColor = (type) => EVENT_TYPES.find(t => t.value === type)?.color || 'bg-slate-500';
  const getEventLabel = (type) => EVENT_TYPES.find(t => t.value === type)?.label || type;

  // Filtered events for the right-hand panel
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

  const handleDayClick = (day) => {
    setSelectedDate(day);
    setForm({ ...emptyEvent, date: format(day, 'yyyy-MM-dd') });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createMutation.mutateAsync(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <TopBar title={t('calendar')} />
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
          <Button onClick={() => { setForm({ ...emptyEvent, date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '' }); setShowForm(true); }} className="gap-2 w-full md:w-auto">
            <Plus className="w-4 h-4" /> {t('addEvent')}
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
                          <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", getEventColor(ev.type))} />
                          <span className="text-xs truncate">{ev.title}</span>
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-xs text-muted-foreground">+{dayEvents.length - 3} {t('more')}</span>
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
                  onClick={() => { setForm({ ...emptyEvent, date: format(selectedDate, 'yyyy-MM-dd') }); setShowForm(true); }}
                >
                  <Plus className="w-3 h-3 mr-1" /> {t('addEvent')}
                </Button>
              )}
            </div>

            {/* Scrollable Event List */}
            <div className="p-3 space-y-2 overflow-y-auto max-h-[580px]">
              {isLoading && (
                <div className="text-center py-12 text-sm text-muted-foreground">{t('loading') || 'Loading…'}</div>
              )}

              {!isLoading && panelEvents.length === 0 && (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {selectedDate ? (t('noEventsOnThisDay') || 'No events on this day.') : (t('noUpcomingEvents') || 'No upcoming events.')}
                </div>
              )}

              {!isLoading && panelEvents.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => setSelectedEvent(ev)}
                  className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary space-y-2 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn("w-2 h-2 rounded-full flex-shrink-0", getEventColor(ev.type))} />
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
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add Event Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-heading">{t('newEvent')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
            <div>
              <Label>Description</Label>
              <Textarea 
                value={form.description} 
                onChange={e => setForm({...form, description: e.target.value.slice(0, 150)})} 
                maxLength={150}
                rows={2} 
              />
              <span className="text-xs text-muted-foreground">{form.description.length}/150</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Date *</Label><Input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Time *</Label><Input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} required /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.title || !form.date || !form.time}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Event Detail Dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        {selectedEvent && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2">
                <div className={cn("w-3 h-3 rounded-full flex-shrink-0", getEventColor(selectedEvent.type))} />
                <span className="truncate">{selectedEvent.title}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
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

              <div>
                <span className="inline-block px-2.5 py-1 rounded text-xs font-semibold bg-muted text-muted-foreground uppercase tracking-wider">
                  {getEventLabel(selectedEvent.type)}
                </span>
              </div>

              {selectedEvent.description && (
                <div className="pt-2 border-t border-border">
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{t('description') || 'Description'}</h5>
                  <p className="text-foreground whitespace-pre-wrap text-sm">{selectedEvent.description}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedEvent(null)}>{t('close') || 'Close'}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
