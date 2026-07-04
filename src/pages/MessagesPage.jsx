import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { MessageSquare, Send, Search, Check, CheckCheck, Mic, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/avatar';
import AudioMessagePlayer from '@/components/teams/AudioMessagePlayer';

const ERROR_MESSAGES = {
  NotAllowedError: 'Microphone access blocked. Please click the camera/lock icon in your browser address bar and select \'Allow\', or check your System Settings.',
  NotFoundError: 'No microphone detected. Please plug in a device and try again.',
  DevicesNotFoundError: 'No microphone detected. Please plug in a device and try again.',
  NotReadableError: 'Microphone is busy. Please close other applications using your mic.',
  TrackStartError: 'Microphone is busy. Please close other applications using your mic.',
};

export default function MessagesPage() {
  const { user } = useAuth();
  const userId = user?.id;

  const [contacts, setContacts] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [unreadMap, setUnreadMap] = useState({});
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [audioBlob, setAudioBlob] = useState(null);
  const [micError, setMicError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isContactsCollapsed, setIsContactsCollapsed] = useState(false);

  const timerRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef('audio/webm');
  const scrollRef = useRef(null);

  const selectedContact = contacts.find(c => c.id === selectedUserId);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    Promise.all([
      supabase.from('messages').select('sender_id, receiver_id').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
      supabase.from('messages').select('sender_id').eq('receiver_id', userId).eq('is_read', false),
      supabase
        .from('profiles')
        .select('id, email, full_name, role_id, roles(name)')
        .neq('id', userId)
        .order('full_name'),
    ]).then(([allMessagesRes, unreadRes, profilesRes]) => {
      const partnerIds = new Set();
      (allMessagesRes.data ?? []).forEach(m => {
        if (m.sender_id === userId) partnerIds.add(m.receiver_id);
        if (m.receiver_id === userId) partnerIds.add(m.sender_id);
      });

      const counts = {};
      (unreadRes.data ?? []).forEach(m => {
        counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
      });

      const allProfiles = profilesRes.data ?? [];

      const partnerProfiles = allProfiles.filter(p => partnerIds.has(p.id));

      const availableProfiles = allProfiles.filter(p =>
        !partnerIds.has(p.id) && p.roles?.name !== 'client'
      );

      setContacts([...partnerProfiles, ...availableProfiles]);
      setUnreadMap(counts);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!userId || !selectedUserId) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${userId})`)
        .order('created_at', { ascending: true });
      if (!error && data) setMessages(data);
    };

    fetchMessages();

    supabase
      .from('messages')
      .update({ is_read: true })
      .eq('sender_id', selectedUserId)
      .eq('receiver_id', userId)
      .eq('is_read', false);

    setUnreadMap(prev => ({ ...prev, [selectedUserId]: 0 }));

    const channel = supabase
      .channel(`messages-full-${userId}-${selectedUserId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `receiver_id=eq.${selectedUserId}` },
        (payload) => {
          if (payload.new.sender_id === userId) {
            setMessages(prev => [...prev, payload.new]);
          }
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `receiver_id=eq.${userId}` },
        (payload) => {
          if (payload.new.sender_id === selectedUserId) {
            setMessages(prev => [...prev, payload.new]);
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages',
          filter: `receiver_id=eq.${userId}` },
        (payload) => {
          if (payload.new.sender_id === selectedUserId) {
            setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, is_read: true } : m));
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, selectedUserId]);

  const handleSend = async () => {
    const content = text.trim();
    const hasAudio = !!audioBlob;
    if (!content && !hasAudio) return;

    try {
      let audioUrl = null;
      if (hasAudio) {
        if (audioBlob.size === 0) return;
        const ext = mimeTypeRef.current.includes('opus') ? 'webm' : 'webm';
        const fileName = `messages/${selectedUserId}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('voice-messages')
          .upload(fileName, audioBlob, { contentType: mimeTypeRef.current });
        if (uploadError) throw uploadError;
        audioUrl = uploadData?.path;
      }

      const { error: insertError } = await supabase
        .from('messages')
        .insert({
          sender_id: userId,
          receiver_id: selectedUserId,
          content: content || null,
          audio_url: audioUrl,
          is_read: false,
        });
      if (insertError) throw insertError;

      setText('');
      setAudioBlob(null);
    } catch (err) {
      console.error('[MessagesPage] send error:', err);
    }
  };

  const startRecording = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mimeTypeRef.current = mimeType;
      mediaRef.current = new MediaRecorder(stream, { mimeType });

      mediaRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        setAudioBlob(blob);
      };

      mediaRef.current.start();
      setRecording(true);
      setSecondsLeft(60);
      timerRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) { stopRecording(); return 0; }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      const name = err?.name;
      setMicError(ERROR_MESSAGES[name] || 'Microphone access failed. Please try again.');
    }
  };

  const stopRecording = () => {
    try {
      if (mediaRef.current && mediaRef.current.state !== 'inactive') {
        mediaRef.current.stop();
        mediaRef.current.stream.getTracks().forEach(t => t.stop());
      }
      clearInterval(timerRef.current);
      setRecording(false);
      setSecondsLeft(60);
    } catch (err) {
      console.error('[MessagesPage] stopRecording error:', err);
    }
  };

  useEffect(() => () => {
    clearInterval(timerRef.current);
    if (mediaRef.current?.stream) {
      mediaRef.current.stream.getTracks().forEach(t => t.stop());
    }
  }, []);

  const filteredContacts = contacts.filter(c =>
    !search || c.full_name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const renderChatContent = () => (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 shrink-0" onClick={() => setSelectedUserId(null)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Avatar className="w-8 h-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {getInitials(selectedContact?.full_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{selectedContact?.full_name || 'Unknown'}</p>
          <p className="text-xs text-muted-foreground truncate">{selectedContact?.email}</p>
        </div>
      </div>

      {/* Message feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map(msg => {
            const isSender = msg.sender_id === userId;
            return (
              <div key={msg.id} className={cn("flex", isSender ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[75%] rounded-2xl px-3.5 py-2",
                  isSender
                    ? "bg-gradient-to-r from-rose-400 to-pink-500 text-white rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                )}>
                  {msg.content && (
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                  )}
                  {msg.audio_url && (
                    <AudioMessagePlayer audioUrl={msg.audio_url} sender={isSender} />
                  )}
                  {isSender && (
                    <span className="flex justify-end mt-1">
                      {msg.is_read ? (
                        <CheckCheck className="w-3.5 h-3.5 text-white/60" />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-white/40" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card p-4 space-y-3 shrink-0 w-full">
        {micError && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-lg px-3 py-2.5 leading-relaxed">
            {micError}
          </div>
        )}
        <Textarea
          placeholder="Type a message..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          className="text-sm resize-none h-16 min-h-0 w-full"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={recording ? 'destructive' : 'secondary'}
            className="gap-1.5 text-xs flex-1"
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? (
              <>
                <Square className="w-3 h-3" />
                Stop ({secondsLeft}s)
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse ml-1" />
              </>
            ) : (
              <><Mic className="w-3 h-3" /> Voice Note</>
            )}
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleSend} disabled={!text.trim() && !audioBlob}>
            <Send className="w-3 h-3" /> Send
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="h-screen flex flex-col w-full max-w-full">
      <TopBar title="Messages" />

      <div className="flex flex-1 overflow-hidden w-full max-w-full">
        {/* Contact List */}
        <div className={cn(
          "flex-col bg-card shrink-0 border-border transition-all duration-300 ease-in-out",
          "md:flex md:border-r overflow-hidden",
          selectedUserId ? "hidden md:flex" : "flex",
          isContactsCollapsed ? "w-full md:w-16" : "w-full md:w-80"
        )}>
          <div className="p-3 border-b border-border flex items-center gap-2">
            {isContactsCollapsed ? (
              <Button variant="ghost" size="icon" onClick={() => setIsContactsCollapsed(false)} className="mx-auto h-8 w-8 shrink-0">
                <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search contacts..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-9 bg-secondary border-0"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsContactsCollapsed(true)} className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {search ? 'No contacts match your search.' : 'No contacts available.'}
              </div>
            ) : (
              filteredContacts.map(contact => {
                const isSelected = contact.id === selectedUserId;
                const unread = unreadMap[contact.id] || 0;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedUserId(contact.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent border-b border-border/50",
                      isSelected && "bg-accent"
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(contact.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      {unread > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                    <div className={cn("flex-1 min-w-0", isContactsCollapsed && "hidden")}>
                      <p className="text-sm font-medium truncate">{contact.full_name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Conversation Pane */}
        <div className={cn(
          "flex-1 flex-col bg-background min-w-0 max-w-full w-full overflow-x-hidden",
          "md:flex",
          !selectedUserId ? "hidden md:flex" : "flex"
        )}>
          {!selectedUserId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-muted-foreground">Your Messages</h3>
                <p className="text-sm text-muted-foreground/60 mt-1">Select a contact to start chatting.</p>
              </div>
            </div>
          ) : (
            renderChatContent()
          )}
        </div>
      </div>
    </div>
  );
}
