import { useTranslation } from 'react-i18next';
import React, { useState, useRef, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Mic, Send, Square } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

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

  const startRecording = async () => {
    try {
      console.log('[Audio] Requesting mic...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      mediaRef.current = new MediaRecorder(stream);

      mediaRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          console.log('[Audio] Chunk:', e.data.size, 'bytes');
          chunksRef.current.push(e.data);
        }
      };

      mediaRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
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
        const fileName = `messages/${member?.id}/${Date.now()}.webm`;
        console.log('[Message] Uploading audio to:', fileName);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('voice-messages')
          .upload(fileName, audioBlob, { contentType: 'audio/webm' });
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
      <PopoverContent className="w-72 p-4 space-y-3" side="top">
        <p className="text-sm font-semibold">{t('messageButton')} {member.full_name?.split(' ')[0]}</p>
        <Textarea
          placeholder={t('typeAMessage')}
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="text-sm resize-none h-20"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={recording ? 'destructive' : 'secondary'}
            className="gap-1.5 text-xs flex-1"
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? (
              <><Square className="w-3 h-3" /> {t('stop')} ({secondsLeft}s)</>
            ) : (
              <><Mic className="w-3 h-3" /> {t('recordVoice')}</>
            )}
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleSendMessage} disabled={!message.trim() && !audioBlob}>
            <Send className="w-3 h-3" /> {t('send')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
