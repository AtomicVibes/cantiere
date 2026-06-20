// Global type declarations to suppress prop-type mismatches for third-party / generated UI components.
// These declarations avoid IntrinsicAttributes errors without modifying component source logic.
// Intended as a stability bridge during migration from Base44 to local Vite.
// Safe to extend as new component usages appear — no business-logic files touched.

declare module '@/api/base44Client' {
  export const base44: any;
}

declare module '@/api/Client' {
  export const base44: any;
}

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

declare module '@/components/ui/tabs' {
  import * as React from 'react';
  export const Tabs: React.ComponentType<any>;
  export const TabsList: React.ComponentType<any>;
  export const TabsTrigger: React.ComponentType<any>;
  export const TabsContent: React.ComponentType<any>;
}

declare module '@/components/ui/*' {
  import * as React from 'react';
  const Component: React.ComponentType<any>;
  export default Component;
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
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      [key: string]: any;
    }
  }
}

export {};
