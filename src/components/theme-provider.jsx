import { ThemeProvider as NextThemesProvider } from 'next-themes';

// Root theme provider following the official shadcn/ui dark-mode pattern
// (attribute="class", system default, system tracking). Single storage key
// shared with the pre-existing Settings appearance control so saved user
// choices are preserved. The accent/event-color systems read the resolved
// `dark` class and are unaffected.
export function ThemeProvider({ children, ...props }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="app-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
