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
import { Checkbox } from '@/components/ui/checkbox';
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
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Lock, Globe, Users, Folder, Trash2, Archive } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isAfter, startOfDay } from 'date-fns';

const emptyEvent = { title: '', description: '', type: 'other', date: '', time: '', location: '', visibility: 'private', project_id: 'none' };

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
    { value: 'other', label: t('other') || 'Other', color: 'bg-slate-500' },
  ];
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEvent);
  const [selectedAudience, setSelectedAudience] = useState([]);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: authUser } = useQuery({
    queryKey: ['authUser'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data?.user || null;
    },
  });

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendarEvents'],
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
    initialData: [],
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

      const unique = Array.from(new Map(combined.map(item => [item.user_id, item])).values());
      return unique;
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
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        throw new Error('Not authenticated — cannot save event');
      }

      if (payload.visibility === 'selected' && selectedAudience.length === 0) {
        throw new Error('Please select at least one audience member for selected visibility.');
      }

      const row = {
        user_id: userData.user.id,
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

      const { data: newEvent, error } = await supabase
        .from('events')
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      if (row.visibility === 'selected' && selectedAudience.length > 0) {
        const audienceRows = selectedAudience.map(uid => ({
          event_id: newEvent.id,
          user_id: uid,
        }));
        const { error: audErr } = await supabase.from('event_audience').insert(audienceRows);
        if (audErr) throw audErr;
      }

      return newEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      setShowForm(false);
      setForm(emptyEvent);
      setSelectedAudience([]);
    },
    onError: (err) => {
      console.error('[CalendarPage] create error:', err);
      alert(`Could not save event: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
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
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      setSelectedEvent(null);
    },
    onError: (err) => {
      console.error('[CalendarPage] archive error:', err);
      alert(`Could not update archive status: ${err.message}`);
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

  const filteredTeamMembers = teamMembers.filter(m => 
    m.full_name.toLowerCase().includes(audienceSearch.toLowerCase()) ||
    m.job_title.toLowerCase().includes(audienceSearch.toLowerCase()) ||
    m.department.toLowerCase().includes(audienceSearch.toLowerCase())
  );

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

  const isOwner = selectedEvent && authUser && selectedEvent.user_id === authUser.id;

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
          <Button onClick={() => { setForm({ ...emptyEvent, date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '' }); setSelectedAudience([]); setShowForm(true); }} className="gap-2 w-full md:w-auto">
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
                          <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", getEventColor(ev.type))} />
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
                  onClick={() => { setForm({ ...emptyEvent, date: format(selectedDate, 'yyyy-MM-dd') }); setSelectedAudience([]); setShowForm(true); }}
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

              {!isLoading && panelEvents.length === 0 && (
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
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Add Event Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">{t('newEvent') || 'New Event'}</DialogTitle></DialogHeader>
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('type') || 'Type'}</Label>
                <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{t('date') || 'Date'} *</Label><Input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} required /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>{t('time') || 'Time'} *</Label><Input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} required /></div>
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
                          if (isChecked) {
                            setSelectedAudience(selectedAudience.filter(id => id !== member.user_id));
                          } else {
                            setSelectedAudience([...selectedAudience, member.user_id]);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-xs",
                          isChecked ? "bg-primary/10 border border-primary/30" : "hover:bg-muted"
                        )}
                      >
                        <Checkbox checked={isChecked} onCheckedChange={() => {}} />
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
                  <div className={cn("w-3 h-3 rounded-full flex-shrink-0", getEventColor(selectedEvent.type))} />
                  <span className="truncate">{selectedEvent.title}</span>
                </div>
              </DialogTitle>
            </DialogHeader>

            <div className="p-6 pt-2 space-y-4 text-sm overflow-y-auto flex-1">
              {/* Badges Row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-muted text-muted-foreground uppercase tracking-wider">
                  {getEventLabel(selectedEvent.type)}
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
    </div>
  );
}
