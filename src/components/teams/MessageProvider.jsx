import React, { useState, useRef, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Mic, Send, Square } from 'lucide-react';

export default function MessagePopover({ member }) {
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const timerRef = useRef(null);
  const mediaRef = useRef(null);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRef.current = new MediaRecorder(stream);
    mediaRef.current.start();
    setRecording(true);
    setSecondsLeft(60);
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { stopRecording(); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
      mediaRef.current.stream.getTracks().forEach(t => t.stop());
    }
    clearInterval(timerRef.current);
    setRecording(false);
    setSecondsLeft(60);
  };

  useEffect(() => () => { clearInterval(timerRef.current); }, []);

  const handleSend = () => {
    if (message.trim()) setMessage('');
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
          <MessageSquare className="w-3.5 h-3.5" />
          Message
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 space-y-3" side="top">
        <p className="text-sm font-semibold">Message {member.full_name?.split(' ')[0]}</p>
        <Textarea
          placeholder="Type a quick message..."
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
              <><Square className="w-3 h-3" /> Stop ({secondsLeft}s)</>
            ) : (
              <><Mic className="w-3 h-3" /> Record Voice</>
            )}
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleSend} disabled={!message.trim()}>
            <Send className="w-3 h-3" /> Send
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}