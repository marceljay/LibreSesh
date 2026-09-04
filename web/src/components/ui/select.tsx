import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Select on Base UI, styled to sit beside the app's own fields (rounded-lg,
 * the 2.375rem control height, stone tokens). Unlike a native `<select>`, the
 * open menu is real DOM we can theme, and the value stays its real type — a
 * numeric room/track id comes back a number, not a string.
 */
export const Select = BaseSelect.Root;
export const SelectGroup = BaseSelect.Group;

export function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.Value>) {
  return <BaseSelect.Value className={cn('truncate', className)} {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        // Same fill as `fieldSurfaceClass` in ui.tsx; written out because this
        // file is token-driven and Tailwind must see the literal classes.
        'flex h-[2.375rem] w-full items-center justify-between gap-2 rounded-lg border border-input bg-stone-50 px-3 text-base sm:text-sm dark:bg-stone-950',
        'outline-hidden transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
        'focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring',
        'text-foreground data-[placeholder]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="shrink-0 text-muted-foreground">
        <ChevronDown className="h-4 w-4" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof BaseSelect.Popup> & { sideOffset?: number }) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={sideOffset} className="z-50 outline-hidden">
        <BaseSelect.Popup
          className={cn(
            'max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-md py-1.5 ps-2 pe-8 text-sm outline-hidden',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="absolute end-2 flex items-center">
        <Check className="h-4 w-4" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}
