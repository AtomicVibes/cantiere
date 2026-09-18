import React, { useState } from 'react';
import { FileText, Play, X, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const getFileName = (document) => document?.name || document?.file_name || 'Document';

const isPdfDocument = (document) => {
  if (!document) return false;
  const mimeType = (document.mime_type || '').toLowerCase();
  if (mimeType === 'application/pdf') return true;
  if ((document.file_format || '').toLowerCase() === 'pdf') return true;
  return getFileName(document).toLowerCase().endsWith('.pdf');
};

export default function DocumentPreview({ document, compact = false, showLabel = false, thumbnailClassName = 'w-16 h-16' }) {
  const [open, setOpen] = useState(false);
  if (!document?.file_url) return <FileText className="w-8 h-8 text-muted-foreground" />;

  const label = getFileName(document);
  const mimeType = document.mime_type || '';
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isPdf = isPdfDocument(document);
  const canPreviewInline = isImage || isVideo || isPdf;
  const fileUrl = document.file_url;
  const iconFallback = <FileText className="w-8 h-8 text-muted-foreground" />;

  const fullPreview = isImage ? (
    <img src={fileUrl} alt={label} className="max-h-[70vh] max-w-full object-contain" />
  ) : isVideo ? (
    <video src={fileUrl} controls className="max-h-[70vh] max-w-full" />
  ) : isPdf ? (
    // Private bucket: file_url is the signed URL generated from storage_path.
    <iframe src={fileUrl} title={label} className="w-full h-[70vh] rounded-md border border-border bg-background" />
  ) : (
    iconFallback
  );

  const buttonContent = compact
    ? isImage
      ? <img src={fileUrl} alt={label} className={`${thumbnailClassName} object-cover rounded`} />
      : isVideo
        ? <div className={`${thumbnailClassName} rounded bg-muted flex items-center justify-center`}><Play className="w-4 h-4" /></div>
        : iconFallback
    : isPdf
      ? iconFallback
      : fullPreview;

  return (
    <>
      <button
        type="button"
        onClick={() => (canPreviewInline ? setOpen(true) : window.open(fileUrl, '_blank', 'noopener,noreferrer'))}
        className={showLabel ? 'inline-flex items-center gap-2 text-sm text-primary hover:underline' : 'block'}
        title={isPdf ? 'Preview PDF' : 'Open document'}
      >
        {buttonContent}
        {showLabel && <span>Preview</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={isPdf ? 'max-w-4xl w-full' : 'max-w-4xl flex items-center justify-center'}>
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} className="absolute right-3 top-3"><X className="w-4 h-4" /></Button>
          {fullPreview}
          {isPdf && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="w-3 h-3" /> Open in new tab
            </a>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
