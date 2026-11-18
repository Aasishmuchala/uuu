# useImperativeDialog
Import: import { useImperativeDialog } from '@astryxdesign/core';

hook to show a dialog w/o managing open state; call dialog.show(content, options) to open + dialog.hide() to close; render dialog.element in your JSX tree

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| show | (content: ReactNode, options?: DialogOptions) => void |  |  | show the dialog with given content; options = Dialog props minus isOpen/onOpenChange/children |
| hide | () => void |  |  | hide the dialog |
| isOpen | boolean |  |  | whether the dialog is currently open |
| element | ReactNode |  |  | the dialog element: render this in your JSX tree |
