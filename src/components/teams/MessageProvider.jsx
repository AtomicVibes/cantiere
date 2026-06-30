import { useTranslation } from 'react-i18next';
import React, { useState, useRef, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Mic, Send, Square } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import AudioMessagePlayer from './AudioMessagePlayer';

export default function MessagePopover({ member }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [audioBlob, setAudioBlob] = useState(null);
  const [messages, setMessages] = useState([]);
  const timerRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef('audio/webm');

  const startRecording = async () => {
    try {
      console.log('[Audio] Requesting mic...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      console.log('[Audio] Using mimeType:', mimeType);
      mimeTypeRef.current = mimeType;
      mediaRef.current = new MediaRecorder(stream, { mimeType });

      mediaRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          console.log('[Audio] Chunk:', e.data.size, 'bytes');
          chunksRef.current.push(e.data);
        }
      };

      mediaRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        console.log('[Audio] Final blob:', blob.size, 'bytes');
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
      console.error('[Audio] startRecording error:', err);
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
      console.error('[Audio] stopRecording error:', err);
    }
  };

  useEffect(() => () => { clearInterval(timerRef.current); }, []);

  useEffect(() => {
    if (!member?.id) return;

    const channel = supabase.channel(`messages-${member.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `receiver_id=eq.${member.id}` },
        (payload) => {
          console.log('[Message] Realtime received:', payload.new);
          setMessages(prev => [...prev, payload.new]);
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [member?.id]);

  const handleSendMessage = async () => {
    try {
      const text = message.trim();
      const hasAudio = !!audioBlob;

      if (!text && !hasAudio) {
        console.warn('[Message] Nothing to send');
        return;
      }

      console.log('[Message] Sending to:', member?.id, '| text:', !!text, '| audio:', hasAudio);

      let audioUrl = null;
      if (hasAudio) {
        if (audioBlob.size === 0) {
          console.warn('[Message] Audio blob is empty, skipping upload');
          return;
        }
        const ext = mimeTypeRef.current.includes('opus') ? 'webm' : 'webm';
        const fileName = `messages/${member?.id}/${Date.now()}.${ext}`;
        console.log('[Message] Uploading audio to:', fileName);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('voice-messages')
          .upload(fileName, audioBlob, { contentType: mimeTypeRef.current });
        if (uploadError) throw uploadError;
        console.log('[Message] Upload success:', uploadData?.path);
        audioUrl = uploadData?.path;
      }

      console.log('[Message] Inserting message record...');
      const { error: insertError } = await supabase
        .from('messages')
        .insert({
          sender_id: user?.id,
          receiver_id: member?.id,
          text: text || null,
          audio_url: audioUrl,
        });
      if (insertError) throw insertError;

      console.log('[Message] Insert success');
      setMessage('');
      setAudioBlob(null);
    } catch (err) {
      console.error('[Message] handleSendMessage error:', err);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
          <MessageSquare className="w-3.5 h-3.5" />
          {t('messageButton')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" side="top">
        <div className="flex flex-col h-[420px]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
              {member.full_name?.charAt(0)?.toUpperCase()}
            </div>
            <p className="text-sm font-semibold">{member.full_name?.split(' ')[0]}</p>
          </div>

          <ScrollArea className="flex-1 px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground text-center">
                  {t('typeAMessage')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => {
                  const isSender = msg.sender_id === user?.id;
                  return (
                    <div
                      key={msg.id || msg.created_date}
                      className={cn("flex", isSender ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2",
                          isSender
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-muted rounded-tl-sm"
                        )}
                      >
                        {msg.text && (
                          <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                        )}
                        {msg.audio_url && (
                          <AudioMessagePlayer audioUrl={msg.audio_url} sender={isSender} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-border p-4 space-y-3">
            <Textarea
              placeholder={t('typeAMessage')}
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="text-sm resize-none h-16 min-h-0"
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
                    {t('stop')} ({secondsLeft}s)
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse ml-1" />
                  </>
                ) : (
                  <><Mic className="w-3 h-3" /> {t('recordVoice')}</>
                )}
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={handleSendMessage} disabled={!message.trim() && !audioBlob}>
                <Send className="w-3 h-3" /> {t('send')}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
