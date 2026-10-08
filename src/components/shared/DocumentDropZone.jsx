import { useCallback, useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function DocumentDropZone({
  file,
  fileError,
  uploading,
  disabled,
  accept,
  maxSize,
  onFileSelect,
  onFileRemove,
  onDragOver,
  onDragLeave,
  onDrop,
  showRemoveButton = true,
  className = '',
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    onDragOver?.(e);
  }, [onDragOver]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget)) {
      setIsDragging(false);
      onDragLeave?.(e);
    }
  }, [onDragLeave]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) {
      onFileSelect?.(droppedFile);
      onDrop?.(droppedFile);
    }
  }, [onFileSelect, onDrop]);

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleKeyDown = useCallback((e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleFileInputChange = useCallback((e) => {
    const selectedFile = e.target.files?.[0] || null;
    onFileSelect?.(selectedFile);
    e.target.value = '';
  }, [onFileSelect]);

  const handleRemove = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    onFileRemove?.();
  }, [onFileRemove]);

  const isError = !!fileError;
  const isFileSelected = !!file;

  const baseStyles = `
    flex flex-col items-center justify-center gap-2 rounded-lg border-2
    transition-all duration-200 ease-out
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
  `;

  const getDropZoneClasses = () => {
    const classes = [baseStyles, className];

    if (disabled) {
      classes.push('opacity-50 cursor-not-allowed');
    } else {
      classes.push('cursor-pointer');
    }

    if (isError) {
      classes.push('border-destructive/60 bg-destructive/5 text-destructive');
    } else if (isDragging) {
      classes.push('border-primary bg-primary/10 ring-1 ring-primary/20');
    } else if (isFileSelected) {
      classes.push('border-primary/50 bg-primary/5');
    } else {
      classes.push('border-primary/50 bg-primary/5 hover:border-primary/70 hover:bg-primary/10');
    }

    return classes.join(' ');
  };

  const getIconColor = () => {
    if (isError) return 'text-destructive';
    if (isDragging || isFileSelected) return 'text-primary';
    return 'text-primary';
  };

  const instructionText = isFileSelected
    ? t('dropFileSelected', { defaultValue: 'File selected. Drop another file to replace, or click to browse.' })
    : t('dropFileHint', { defaultValue: 'Drag & drop a file here, or click to browse' });

  return (
    <div
      ref={dropZoneRef}
      className="w-full"
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label={ariaLabel || t('attachDocument', { defaultValue: 'Attach a document' })}
      aria-describedby={ariaDescribedBy}
      aria-invalid={isError}
      aria-disabled={disabled}
    >
      <div
        className={getDropZoneClasses()}
        style={{ minHeight: '120px', padding: '24px 16px' }}
      >
        <Upload
          className={`w-8 h-8 shrink-0 ${getIconColor()}`}
          aria-hidden="true"
        />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {instructionText}
          </p>
          {!isFileSelected && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('dropFileTypes', { defaultValue: 'JPG, PNG, WebP, GIF, PDF, MP4, WebM, MOV, DOC, DOCX, XLS, XLSX - up to 50 MB' })}
            </p>
          )}
          {uploading && (
            <div className="flex items-center gap-1.5 text-xs text-primary mt-2" role="status" aria-live="polite">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>{t('uploading', { defaultValue: 'Uploading...' })}</span>
            </div>
          )}
          {isError && (
            <p className="text-xs font-medium text-destructive mt-2" role="alert">
              {t('invalidFile', { defaultValue: 'This file type or size is not supported.' })}
            </p>
          )}
          {isFileSelected && (
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="max-w-[200px] truncate font-medium text-foreground">
                {file.name}
              </span>
              {showRemoveButton && !disabled && !uploading && (
                <button
                  type="button"
                  onClick={handleRemove}
                  className="flex items-center justify-center gap-1 px-2 py-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label={t('removeFile', { defaultValue: 'Remove file' })}
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileInputChange}
        disabled={disabled || uploading}
        id={id}
        aria-hidden="true"
      />
    </div>
  );
}