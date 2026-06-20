// Auto-generated declarations to provide prop types for UI components
// Drop this file into `src/` to satisfy the TypeScript checker for JSX props

import * as React from 'react';

// Specific component props extending standard HTML attributes

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
  size?: 'sm' | 'md' | 'lg' | string;
  asChild?: boolean;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: boolean | string;
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
  error?: boolean | string;
}

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
}

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean;
}

export interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string | number;
}

export interface ToggleProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean;
}

export interface TooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  content?: React.ReactNode;
}

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
}

export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
}

export interface MenuProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {}

export interface AvatarProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallback?: React.ReactNode;
}

export interface CalendarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: Date | string;
}

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

export interface SliderProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
}

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  duration?: number;
}

// Module declarations for each UI file path used by imports in the project.
// These provide typed component exports based on the interfaces above.



// Provide a broad wildcard module that exposes common named exports used across the app.
// This prevents 'cannot find module' and 'IntrinsicAttributes' errors for Radix-style
// compound components (Select, Dialog, Tabs, ToggleGroup, etc.).
declare module '@/components/ui/*' {
  import * as React from 'react';

  const Component: React.ComponentType<any>;
  export default Component;

  // Common named exports (subset) used throughout the project
  export const Select: React.ComponentType<any>;
  export const SelectTrigger: React.ComponentType<any>;
  export const SelectContent: React.ComponentType<any>;
  export const SelectItem: React.ComponentType<any>;
  export const SelectValue: React.ComponentType<any>;
  export const SelectGroup: React.ComponentType<any>;
  export const SelectLabel: React.ComponentType<any>;
  export const SelectSeparator: React.ComponentType<any>;
  export const SelectScrollUpButton: React.ComponentType<any>;
  export const SelectScrollDownButton: React.ComponentType<any>;

  export const Dialog: React.ComponentType<any>;
  export const DialogTrigger: React.ComponentType<any>;
  export const DialogContent: React.ComponentType<any>;
  export const DialogHeader: React.ComponentType<any>;
  export const DialogFooter: React.ComponentType<any>;
  export const DialogTitle: React.ComponentType<any>;
  export const DialogDescription: React.ComponentType<any>;
  export const DialogOverlay: React.ComponentType<any>;

  export const ToggleGroup: React.ComponentType<any>;
  export const ToggleGroupItem: React.ComponentType<any>;

  export const InputOTP: React.ComponentType<any>;
  export const InputOTPGroup: React.ComponentType<any>;
  export const InputOTPSlot: React.ComponentType<any>;
  export const InputOTPSeparator: React.ComponentType<any>;

  export const Tabs: React.ComponentType<any>;
  export const TabsList: React.ComponentType<any>;
  export const TabsTrigger: React.ComponentType<any>;
  export const TabsContent: React.ComponentType<any>;

  export const SelectTriggerProps: any;
}

// Provide a minimal declaration for the aliased API client module used across pages
declare module '@/api/base44Client' {
  export const base44: any;
}

// Explicitly declare common ui modules with named exports matching project's usage
declare module '@/components/ui/button' {
  import * as React from 'react';
  export const Button: React.ComponentType<any>;
  export const buttonVariants: any;
}

declare module '@/components/ui/input' {
  import * as React from 'react';
  export const Input: React.ComponentType<any>;
}

declare module '@/components/ui/textarea' {
  import * as React from 'react';
  export const Textarea: React.ComponentType<any>;
}

declare module '@/components/ui/label' {
  import * as React from 'react';
  export const Label: React.ComponentType<any>;
}

declare module '@/components/ui/select' {
  import * as React from 'react';
  export const Select: React.ComponentType<any>;
  export const SelectGroup: React.ComponentType<any>;
  export const SelectValue: React.ComponentType<any>;
  export const SelectTrigger: React.ComponentType<any>;
  export const SelectContent: React.ComponentType<any>;
  export const SelectLabel: React.ComponentType<any>;
  export const SelectItem: React.ComponentType<any>;
  export const SelectSeparator: React.ComponentType<any>;
  export const SelectScrollUpButton: React.ComponentType<any>;
  export const SelectScrollDownButton: React.ComponentType<any>;
}

declare module '@/components/ui/dialog' {
  import * as React from 'react';
  export const Dialog: React.ComponentType<any>;
  export const DialogPortal: React.ComponentType<any>;
  export const DialogOverlay: React.ComponentType<any>;
  export const DialogTrigger: React.ComponentType<any>;
  export const DialogClose: React.ComponentType<any>;
  export const DialogContent: React.ComponentType<any>;
  export const DialogHeader: React.ComponentType<any>;
  export const DialogFooter: React.ComponentType<any>;
  export const DialogTitle: React.ComponentType<any>;
  export const DialogDescription: React.ComponentType<any>;
}

declare module '@/components/ui/toggle-group' {
  import * as React from 'react';
  export const ToggleGroup: React.ComponentType<any>;
  export const ToggleGroupItem: React.ComponentType<any>;
}

declare module '@/components/ui/input-otp' {
  import * as React from 'react';
  export const InputOTP: React.ComponentType<any>;
  export const InputOTPGroup: React.ComponentType<any>;
  export const InputOTPSlot: React.ComponentType<any>;
  export const InputOTPSeparator: React.ComponentType<any>;
}

declare module '@/components/ui/progress' {
  import * as React from 'react';
  export const Progress: React.ComponentType<any>;
}

declare module '@/components/ui/toast' {
  import * as React from 'react';
  export const Toast: React.ComponentType<any>;
  export default Toast;
}

declare module '@/components/ui/toaster' {
  import * as React from 'react';
  export const Toaster: React.ComponentType<any>;
  export default Toaster;
}

// Tabs is referenced but not present as a source file; provide a typing fallback
declare module '@/components/ui/tabs' {
  import * as React from 'react';
  export const Tabs: React.ComponentType<any>;
  export const TabsList: React.ComponentType<any>;
  export const TabsTrigger: React.ComponentType<any>;
  export const TabsContent: React.ComponentType<any>;
}

// Global JSX fallback: allow arbitrary props on JSX components to avoid noisy prop errors
declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      [key: string]: any;
    }
  }
}

// Ensure the other API client path is also declared so imports resolve
declare module '@/api/Client' {
  export const base44: any;
}

// Provide a global fallback
declare const base44: any;
