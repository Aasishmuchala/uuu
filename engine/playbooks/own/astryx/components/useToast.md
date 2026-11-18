# useToast
Group: Toast. Category: interaction.
Import: import { useToast } from '@astryxdesign/core';

Show toast notifications from anywhere in component tree. Returns function accepting toast options + showing notification. Works automatically w/ LayerProvider / self-mounts fallback viewport.

## Do
- Use for transient success/error feedback not requiring user action.
- Set uniqueID to deduplicate toasts from rapid user actions.

## Do not
- Use for critical errors requiring acknowledgment; use AlertDialog instead.
- Call useToast in same component that renders LayerProvider; must be called from child component inside provider.

## See also
- Toast
- Banner
- AlertDialog
