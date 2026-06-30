import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';

const emptyEvent = { title: '', description: '', type: 'other', date: '', time: '', location: '' };

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
  const queryClient = useQueryClient();

  const { data: events = [] } = useQuery({
    queryKey: ['calendarEvents'],
    queryFn: () => base44.entities.CalendarEvent.list('-date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.CalendarEvent.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }); setShowForm(false); setForm(emptyEvent); },
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const getEventsForDay = (day) => events.filter(e => e.date && isSameDay(new Date(e.date), day));
  const getEventColor = (type) => EVENT_TYPES.find(t => t.value === type)?.color || 'bg-slate-500';

  const handleDayClick = (day) => {
    setSelectedDate(day);
    setForm({ ...emptyEvent, date: format(day, 'yyyy-MM-dd') });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    await createMutation.mutateAsync(form);
    setSaving(false);
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
          <Button onClick={() => { setForm(emptyEvent); setShowForm(true); }} className="gap-2 w-full md:w-auto">
            <Plus className="w-4 h-4" /> {t('addEvent')}
          </Button>
        </div>

        {/* Calendar Grid */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const dayEvents = getEventsForDay(day);
              const isToday = isSameDay(day, new Date());
              const inMonth = isSameMonth(day, currentDate);
              return (
                <div
                  key={i}
                  className={cn(
                    "min-h-[100px] p-2 border-b border-r border-border cursor-pointer hover:bg-muted/50 transition-colors",
                    !inMonth && "opacity-40"
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
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-heading">{t('newEvent')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} /></div>
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
              <div><Label>Time</Label><Input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.title || !form.date}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}