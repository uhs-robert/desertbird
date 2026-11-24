// The rule that ends insert mode on Escape, shared by the runtimes that have the mode. The capture handler remembers the Escape it let through, and a bubble listener asks here once the other handlers have run. Thunderbird's popup, menu, quick filter or inline rename may have used it, and that use comes first: the next Escape leaves.

export const leaves_insert = (remembered: object | null, event: { defaultPrevented?: boolean }): boolean => remembered === event && !event.defaultPrevented;
