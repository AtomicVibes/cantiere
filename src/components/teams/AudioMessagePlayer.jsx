import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { cn } from '@/lib/utils';

export default function AudioMessagePlayer({ audioUrl, sender }) {
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const [ready, setReady] = useState(false);

  const fullUrl = audioUrl?.startsWith('http')
    ? audioUrl
    : supabase.storage.from('voice-messages').getPublicUrl(audioUrl).data.publicUrl;

  useEffect(() => {
    if (!waveformRef.current || !fullUrl) return;

    const isDark = document.documentElement.classList.contains('dark');

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: sender
        ? 'rgba(255,255,255,0.5)'
        : isDark
          ? 'rgba(255,255,255,0.25)'
          : 'rgba(0,0,0,0.2)',
      progressColor: sender
        ? '#ffffff'
        : isDark
          ? '#f43f5e'
          : 'hsl(var(--primary))',
      cursorColor: 'transparent',
      height: 36,
      barWidth: 2,
      barGap: 1.5,
      barRadius: 2,
      barMinHeight: 2,
      normalize: true,
      autoplay: false,
    });

    ws.load(fullUrl);

    ws.on('ready', () => {
      setReady(true);
      const dur = ws.getDuration();
      setDuration(formatTime(dur));
    });

    ws.on('audioprocess', () => {
      setCurrentTime(formatTime(ws.getCurrentTime()));
    });

    ws.on('finish', () => {
      setPlaying(false);
      setCurrentTime('0:00');
    });

    wavesurferRef.current = ws;

    return () => { ws.destroy(); };
  }, [fullUrl, sender]);

  const togglePlay = () => {
    if (!wavesurferRef.current || !ready) return;
    wavesurferRef.current.playPause();
    setPlaying(p => !p);
  };

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <button
        onClick={togglePlay}
        disabled={!ready}
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
          sender
            ? "bg-white/20 hover:bg-white/30 text-white"
            : "bg-primary/10 hover:bg-primary/20 text-primary"
        )}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div ref={waveformRef} className="flex-1" />
      <span className={cn(
        "text-xs tabular-nums flex-shrink-0 w-8 text-right",
        sender ? "text-white/70" : "text-muted-foreground"
      )}>
        {ready ? currentTime : duration}
      </span>
    </div>
  );
}
