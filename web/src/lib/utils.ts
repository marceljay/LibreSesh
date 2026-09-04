import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's class merge: clsx for conditionals, tailwind-merge to resolve
 *  conflicting Tailwind utilities so a call-site override actually wins (the
 *  thing bare string-concatenation could not do — see the old compact-button
 *  override bug). Every shadcn component composes classes through this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
