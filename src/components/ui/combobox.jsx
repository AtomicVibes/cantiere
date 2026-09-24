"use client"

import * as React from "react"
import { ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

const ComboboxContext = React.createContext(null)

const useCombobox = () => {
  const ctx = React.useContext(ComboboxContext)
  if (!ctx) throw new Error("Combobox components must be used within a <Combobox>")
  return ctx
}

const ComboboxItemContext = React.createContext(null)

const useComboboxItem = () => React.useContext(ComboboxItemContext)

/**
 * Object-aware searchable combobox built on the existing cmdk `Command`
 * primitives. `<Combobox items={...}>` provides the rows, a search value
 * generator, and an `onSelect` handler; children compose the trigger and
 * the popover content.
 *
 * Search is driven by the `values` passed to each `<ComboboxItem>` (cmdk
 * filters on that), so callers can join name/email/title/department/role
 * into one searchable string.
 */
export function Combobox({
  items = [],
  getItemValue,
  getItemKey,
  onSelect,
  onQueryChange,
  shouldFilter,
  children,
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const handleSelect = React.useCallback((item) => {
    setOpen(false)
    setQuery("")
    if (onSelect) onSelect(item)
  }, [onSelect])

  // Lets server-driven callers (e.g. profiles contact search) react to the
  // typed query without taking over the internal input state.
  React.useEffect(() => {
    if (typeof onQueryChange === 'function') onQueryChange(query)
  }, [query, onQueryChange])

  const value = React.useMemo(() => ({
    open,
    setOpen,
    query,
    setQuery,
    items,
    getItemValue,
    handleSelect,
  }), [open, query, items, getItemValue, handleSelect])

  return (
    <ComboboxContext.Provider value={value}>
      <Popover open={open} onOpenChange={setOpen}>
        {children}
      </Popover>
    </ComboboxContext.Provider>
  )
}

export function ComboboxInput({ icon, placeholder = "Select...", className }) {
  const { open, setOpen } = useCombobox()
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn("h-9 w-full justify-between font-normal", className)}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="truncate">{placeholder}</span>
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
  )
}

export function ComboboxContent({ placeholder = "Search...", align = "start", className, children, shouldFilter }) {
  const { query, setQuery } = useCombobox()
  return (
    <PopoverContent align={align} sideOffset={4} className={cn("w-80 p-0", className)}>
      <Command shouldFilter={shouldFilter}>
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          className="h-10"
        />
        {children}
      </Command>
    </PopoverContent>
  )
}

export function ComboboxEmpty({ className, ...props }) {
  return <CommandEmpty {...props} className={cn("py-6 text-center text-sm", className)} />
}

export function ComboboxList({ children }) {
  const { items, getItemKey } = useCombobox()
  return (
    <CommandList>
      <CommandGroup>
        {items.map((item, index) => (
          <ComboboxItemContext.Provider
            key={getItemKey ? getItemKey(item) : index}
            value={{ item }}
          >
            {children(item, index)}
          </ComboboxItemContext.Provider>
        ))}
      </CommandGroup>
    </CommandList>
  )
}

export function ComboboxItem({ value, onSelect, className, children, ...props }) {
  const { item } = useComboboxItem() || {}
  const { getItemValue, handleSelect } = useCombobox()

  const searchValue = value ?? (getItemValue ? String(getItemValue(item)) : String(item ?? ""))
  const selectHandler = onSelect ? () => onSelect(item) : () => handleSelect(item)

  return (
    <CommandItem
      value={searchValue}
      onSelect={selectHandler}
      className={cn("px-2 py-2", className)}
      {...props}
    >
      {children}
    </CommandItem>
  )
}