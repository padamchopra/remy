---
name: ui
description: Layout and keyboard for the Remy web UI. Use when adding or changing ANY web component, dialog, menu, picker, list row, empty state, or shortcut.
---

# UI

`content` owns the words. `qa` owns clicking the result. `.agents/skills/shadcn` owns the CLI, composition rules, and component APIs — read it before adding or rewriting a primitive.

The UI is shadcn New York (Radix, not Base) in `web/src/components/ui`, configured by `web/components.json`. Run CLI commands from `web/`.

## Primitives

Every control comes from `web/src/components/ui`. A primitive that is missing is added with `npx shadcn@latest add <name>` from `web/`, then used.

Answer the prompt to overwrite an existing file with no: the CLI pulls a component's dependencies, and this project has edited some of them.

A custom `div` or `button` is the last resort, after no primitive can do the job.

BAD
```tsx
<div className="rounded-md border">
  {items.map((item) => (
    <button type="button" onClick={() => pick(item)}>{item.label}</button>
  ))}
</div>
```

GOOD
```tsx
<Command shouldFilter={false}>
  <CommandInput value={path} onValueChange={setPath} />
  <CommandList>
    {items.map((item) => (
      <CommandItem key={item.path} value={item.path} onSelect={() => pick(item)}>
        {item.label}
      </CommandItem>
    ))}
  </CommandList>
</Command>
```

| Job | Primitive |
|---|---|
| App chrome | `Sidebar` |
| Searchable, keyboard-driven list | `Command` |
| ⌘K | `CommandDialog` |
| A row with icon, title, description, trailing action | `Item` |
| A message in a thread | `Message` + `Bubble` |
| Empty panel | `Empty` |
| Modal | `Dialog`, or `AlertDialog` to confirm something destructive |
| Menu | `DropdownMenu`, selected marked by a trailing `Check` |
| Form dropdown | `Select` |
| Labeled setting row | `Field` |
| Composing a message | `InputGroup` |
| Transient status | `toast()` from `sonner` |
| Loading text | the `shimmer` class from `shadcn/tailwind.css` |

`Palette.tsx` is the reference for a searchable list, `AppSidebar.tsx` for app chrome, and `PathPicker.tsx` for choosing a folder.

A composed screen assembles primitives; it never replaces one that exists. A control that appears on two screens moves into its own module rather than being copied — `ComposerMenu.tsx` and `PathPicker.tsx` are shared this way.

## Text containment

Every flex or grid child that owns variable text must be able to shrink. Use `min-w-0` on the text-bearing flex child and `minmax(0, 1fr)` for the corresponding grid track; keep icons and trailing actions `shrink-0`.

Choose wrapping or truncation deliberately. `truncate` is only for a bounded single line whose omitted text is acceptable. A title meant to remain readable uses `whitespace-normal break-words`; do not use `break-all` for ordinary prose.

BAD
```tsx
<ItemContent>
  <ItemTitle className="truncate">{artifact.title}</ItemTitle>
</ItemContent>
```

GOOD
```tsx
<ItemContent className="min-w-0">
  <ItemTitle className="w-full whitespace-normal break-words">{artifact.title}</ItemTitle>
</ItemContent>
```

Test variable text in the narrowest pane that can render the component. Use both a long sentence and an unbroken identifier or URL, then confirm the container has no horizontal overflow with `scrollWidth <= clientWidth`. When wrapping is intended, also confirm the text occupies more than one line rather than disappearing behind an ellipsis.

## Scroll ownership

A flex column with `overflow-auto` owns scrolling. Its variable-height groups use `shrink-0`; allowing a group to shrink while its children remain visible makes the next group lay out on top of those children.

BAD
```tsx
<SidebarContent>
  <SidebarGroup className="min-h-0">{threads}</SidebarGroup>
  <SidebarGroup>{archived}</SidebarGroup>
</SidebarContent>
```

GOOD
```tsx
<SidebarContent>
  <SidebarGroup className="shrink-0">{threads}</SidebarGroup>
  <SidebarGroup className="shrink-0">{archived}</SidebarGroup>
</SidebarContent>
```

After rendering the longest realistic list, confirm each group's last child ends at or before the next sibling begins and the scroll container's `scrollHeight` grows beyond its `clientHeight` instead of compressing its children.

## Input capability

Viewport width does not say whether a person has a mouse. A control that stays visible for touch but appears on hover for pointer devices keys its hidden state to `@media (hover: hover)`, not a width breakpoint such as `md`.

BAD
```tsx
className="group-hover/menu-item:opacity-100 md:opacity-0"
```

GOOD
```tsx
className="[@media(hover:hover)]:opacity-0 group-hover/menu-item:!opacity-100 group-focus-within/menu-item:!opacity-100"
```

## Keyboard

Every interactive surface has keyboard access, from the primitive that already implements it rather than a home-rolled `onKeyDown`.

Arrow keys move the highlight, Enter activates, Escape closes, Tab moves between input, list, and footer actions.

In a path picker, Enter opens the highlighted folder so you can keep going, and ⌘Enter confirms.

A shortcut no primitive owns is bound in the component and shown with `Kbd` next to the action.

## Where the window is

Threads, settings tabs, workspaces, and the device scope are hash routes, parsed and formatted by `web/src/lib/route.ts`. A new place a person can be gets a route, so a reload lands back on it.

State that is genuinely transient — an open palette, an open dialog — stays in React.
