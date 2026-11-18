# useImperativeAlertDialog
Import: import { useImperativeAlertDialog } from '@astryxdesign/core';

Hook to show alert dialog w/o managing open state. Call alert.show(options) to open, alert.hide() to close; render alert.element in JSX tree.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| show | (options: AlertDialogOptions) => void |  |  | show dialog w/ options; same as AlertDialog props minus isOpen/onOpenChange |
| hide | () => void |  |  | hide dialog |
| isOpen | boolean |  |  | dialog currently open? |
| element | ReactNode |  |  | dialog element: render in JSX tree |
