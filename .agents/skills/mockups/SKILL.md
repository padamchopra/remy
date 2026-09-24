---
name: mockups
description: Design mockups in the Remy Paper file. Use when creating or changing ANY artboard, page, or app chrome in Paper, including new feature designs and redesigns.
---

# Mockups

`ui` owns the shipped layout and `content` owns the words. This skill owns the
Paper file those designs are drawn in.

A mockup is a claim about the product. Anything it draws that already exists in
the app must match the app, or the design argues against a screen nobody has.

## The file has pages that own things

| Page | Owns |
|---|---|
| `System` | Every colour, as resolved sRGB from `web/src/index.css`. |
| `Sidebar` | The app chrome, one artboard per selected section. |
| A feature page | That feature's artboards, and nothing else. |

**Clone the chrome, never redraw it.** A feature page's window artboards use
`<x-paper-clone node-id="...">` of the `Sidebar` page's frame. Redrawing it from
memory is how a mockup ends up with a wordmark the app does not have and a nav
order it abandoned. When the shipped sidebar changes, the `Sidebar` page changes
once and every page that cloned it is corrected with it.

Fonts are Inter and Geist Mono, mono for branches, SHAs, counts and code.

## Chrome matches the code, not the impression of it

Read the component before drawing its frame. The hosted shell's sidebar is
`web/src/components/HubApp.tsx` — an account picker with a chevron, a new-thread
pencil and the collapse trigger; then Threads, Tasks, Workspaces; then
**Recent threads** with `ThreadSidebarRow`; then Settings and the account row in
the footer. Its width is `--sidebar-width`, 15rem. The pane's header is
`PaneHeader.tsx`: breadcrumbs, last crumb semibold.

The Mac shell and the hosted shell are different windows. Draw the one the work
is for, and say which in the artboard name. Their CSS is not shared either:
`index.css` scopes `.remy-sidebar` rules to the Mac sidebar, so a rule read
there does not describe the hosted one.

A separator, a border and a gap are chrome too. Do not add one the component
does not have — an invented rule reads as decided spacing and leaves a hole
nobody can explain.

BAD
```
A hairline above the footer, because the thread list needs to end somewhere.
```

GOOD
```
SidebarFooter is `flex flex-col gap-2 p-2` with no border, so the mockup has
none either.
```

## An interactive state is drawn from its definition

Hover, selected, open and right-click are states of a real control, so their
items and order come from the code that builds them, not from what a menu
usually holds. The thread row's menu is `threadMenuGroups` in
`web/src/lib/thread-menu.ts` with the icons in `ThreadMenu.tsx`, and its hosted
facts drop `Start subthread…`; the account view picker and the account menu are
the two `DropdownMenu`s in `HubApp.tsx`. Draw the state the shipped code would
produce for the row you are hovering, and put a fuller idea in its own artboard
marked `proposed`.

A state one shell already has is a state the other one owes. Hovering a Mac
thread row opens the `ThreadContext` hover card in `AppSidebar.tsx` — the whole
title, the machine, the workspace, the branch, the model and the ticket, because
the row itself had to truncate all of it. A hosted mockup that leaves it out is
proposing a row with less behind it than the one people use today, so draw it.

Where a row carries meaning as icons, its hover card is that lane in words, in
the same left-to-right order. The icons stay scannable and the card is the
legend; a card ordered differently makes the reader hunt for which glyph it
just explained.

A hover action is one action, and which one depends on the row's state. A row
that reveals an overflow button on hover spends its only affordance on a menu
the right-click already opens. Give it the action that row actually needs — a
thread you are done with is archived, so an idle, errored or finished thread
gets Archive under the cursor, and `threadIsRunning` in `thread-menu.ts` is what
"not working" means, so a working or needs-you thread keeps the overflow. Draw
both, one artboard each, or the rule is a sentence nobody can check.

## Colour comes from the System page

No mockup invents a colour, and no mockup invents a colour's meaning. `--success`
is a state, `--warning` is a state, `--primary` is the one action. A number is
not a state.

BAD
```
A nav row's count in an amber pill, because the count matters.
```

GOOD
```
A nav row's count as muted mono text, like every other count in the sidebar.
```

Tinted backgrounds for state chips are that state's colour composited over the
surface underneath, not a new hex picked by eye.

## An artboard names its state

`Pull requests · Needs you`, `Empty · GitHub not connected`,
`Stale · a computer is offline`. A reviewer scanning the page should know what
each frame is claiming without opening it. A flow that is a popover, a dialog or
a sheet gets its own artboard cropped to the surface, rather than a second copy
of the whole window.

Real states earn artboards: empty, not connected, offline and stale are part of
the design, not omissions to fill in later.

## The words are still the words

Apply `content` to every string in a mockup. Placeholder copy that says
"Lorem" or "shows up here" ships into the implementation, because the person
building from the design reads it as decided.
