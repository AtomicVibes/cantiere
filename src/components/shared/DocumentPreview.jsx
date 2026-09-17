import React, { useState } from 'react';
import { FileText, Play, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function DocumentPreview({ document, compact = false }) {
  const [open, setOpen] = useState(false);
  if (!document?.file_url) return <FileText className="w-8 h-8 text-muted-foreground" />;

  const mimeType = document.mime_type || '';
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  const preview = isImage ? (
    <img src={document.file_url} alt={document.name || document.file_name || 'Document'} className={compact ? 'w-16 h-16 object-cover rounded' : 'max-h-[70vh] max-w-full object-contain'} />
  ) : isVideo ? (
    compact ? <div className="w-16 h-16 rounded bg-muted flex items-center justify-center"><Play className="w-6 h-6" /></div> : <video src={document.file_url} controls className="max-h-[70vh] max-w-full" />
  ) : (
    <FileText className="w-8 h-8 text-muted-foreground" />
  );

  return (
    <>
      <button type="button" onClick={() => (isImage || isVideo) ? setOpen(true) : window.open(document.file_url, '_blank', 'noopener,noreferrer')} className="block" title="Open document">
        {preview}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl flex items-center justify-center">
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} className="absolute right-3 top-3"><X className="w-4 h-4" /></Button>
          {preview}
        </DialogContent>
      </Dialog>
    </>
  );
}
