# useTableInfiniteScroll
Import: import { useTableInfiniteScroll } from '@astryxdesign/core';

Stable flat-data TablePlugin<T>. Three controlled fields: hasMore, isLoading, onLoadMore():Promise<void>. Always-available manual Button; visible sentinel adds automatic loads. Shared latch and post-settlement false commit gate completion. Failure pauses automatic loads; manual retry recovers. Reset by remounting the hook owner and Table together.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| hasMore | boolean |  | yes | Allow another batch. False removes observation/chrome and hands off only owned Button focus. |
| isLoading | boolean |  | yes | Controlled busy flag; pending Promise and its completion commit also block requests. |
| onLoadMore | () => Promise<void> |  | yes | Return batch completion Promise; append rows and suppress stale product responses yourself. |
