import { Fragment } from "react";
import { ChevronDown, ChevronLeft, ChevronsUpDown, Plus, Settings, SquarePen } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarResizeHandle,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemCheck,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu-base";
import { Button } from "@/components/ui/button";
import { AvatarFrom } from "@/components/UserAvatar";
import { SidebarChildThreadRow, SidebarThreadRow } from "./SidebarThreadRow";
import type {
  SidebarAccount,
  SidebarAccountMenu,
  SidebarFooterItem,
  SidebarNavItem,
  SidebarThreadGroup,
} from "./contract";

/// The one sidebar. The Mac shell and the hosted shell read different places
/// and hand it the same shapes, so a change to the chrome lands in both at
/// once rather than in one and eventually the other.
///
/// Threads are in it in every section, because they are the work: whatever
/// else is in front of you, one is always a click away.
export function AppSidebar({
  account,
  nav,
  groups,
  footer,
  accountMenu,
  collapsible = "none",
  emptyThreads,
  back,
  onNewThread,
  showTrigger,
  selected,
}: {
  account?: SidebarAccount;
  nav: SidebarNavItem[];
  groups: SidebarThreadGroup[];
  footer: SidebarFooterItem[];
  accountMenu?: SidebarAccountMenu;
  collapsible?: "none" | "icon";
  /// Shown only when the shell knows there is nothing rather than that it has
  /// not looked yet: "No threads yet." is a claim, and a wrong one on a
  /// machine that has some.
  emptyThreads?: string;
  /// Settings and other sub-navigation replace the picker with a way back.
  back?: { label: string; onSelect: () => void };
  onNewThread?: () => void;
  showTrigger?: boolean;
  selected?: string | null;
}) {
  return (
    <Sidebar collapsible={collapsible} className="remy-sidebar">
      {back ? (
        <SidebarHeader className="flex-row items-center gap-1 px-3 py-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-2">
          <SidebarMenu className="min-w-0 flex-1"><SidebarMenuItem>
            <SidebarMenuButton tooltip={back.label} aria-label={back.label} data-link onClick={back.onSelect}>
              <ChevronLeft /><span>{back.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem></SidebarMenu>
          {showTrigger && <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:order-first" />}
        </SidebarHeader>
      ) : (
        <SidebarHeader className="flex-row items-center gap-1 px-3 py-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-2">
          {account && <AccountPicker account={account} />}
          {onNewThread && (
            <Button variant="ghost" size="icon-sm" aria-label="New thread" title="New thread" data-link onClick={onNewThread}>
              <SquarePen />
            </Button>
          )}
          {showTrigger && <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:order-first" />}
        </SidebarHeader>
      )}

      {nav.length > 0 && (
        <SidebarGroup className="sidebar-navigation shrink-0 px-3 py-0 group-data-[collapsible=icon]:px-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    data-link
                    tooltip={item.label}
                    aria-label={item.label}
                    isActive={item.selected}
                    onClick={item.onSelect}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.count !== undefined && item.count > 0 && (
                    <SidebarMenuBadge className="right-2.5 font-mono text-muted-foreground">{item.count}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <SidebarContent className="sidebar-thread-list mt-4">
        {groups.length === 0 && emptyThreads && (
          <p className="px-[18px] py-1.5 text-[11px] text-muted-foreground">{emptyThreads}</p>
        )}
        {groups.map((group) => (
          <SidebarGroup key={group.key} className="shrink-0 px-3 py-1">
            <SidebarGroupLabel className="sidebar-section-label">
              {group.icon && <group.icon className="size-3 shrink-0" />}
              <span>{group.label}</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {group.threads.map((thread) => (
                  <Fragment key={thread.key}>
                    <SidebarThreadRow thread={thread} active={selected === thread.id} />
                    {thread.children?.map((child, index) => (
                      <SidebarChildThreadRow
                        key={child.key}
                        thread={child}
                        active={selected === child.id}
                        last={index === (thread.children?.length ?? 0) - 1}
                      />
                    ))}
                  </Fragment>
                ))}
                {(group.hidden ?? 0) > 0 && group.onRevealMore && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      data-sidebar-show-more
                      data-hidden-count={group.hidden}
                      size="sm"
                      className="h-8 px-2.5 text-xs text-muted-foreground"
                      onClick={group.onRevealMore}
                    >
                      <ChevronDown />
                      <span>Show {group.hidden} more</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-3 group-data-[collapsible=icon]:px-2">
        {/* Settings is navigation, so it reads like the nav above it rather
            than competing with the account row, which is a person's name. */}
        <SidebarMenu className="sidebar-navigation">
          {footer.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton data-link tooltip={item.label} aria-label={item.label} isActive={item.selected} onClick={item.onSelect}>
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {accountMenu && <SidebarMenu><SidebarMenuItem><AccountMenu menu={accountMenu} /></SidebarMenuItem></SidebarMenu>}
      </SidebarFooter>
      <SidebarResizeHandle />
    </Sidebar>
  );
}

function AccountPicker({ account }: { account: SidebarAccount }) {
  const organizations = account.views.filter((view) => view.organization);
  const rest = account.views.filter((view) => !view.organization);
  // The Mac shell has no accounts to switch between yet. It keeps the same
  // header, without a chevron that would open onto nothing.
  if (account.views.length === 0 && !account.onCreate) {
    return (
      <SidebarMenuButton tooltip={account.label} aria-label={account.label} className="min-w-0 flex-1">
        <account.icon />
        <span className="min-w-0 flex-1 truncate">{account.label}</span>
      </SidebarMenuButton>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={<SidebarMenuButton aria-label="Choose account view" title="Choose account view" className="min-w-0 flex-1" />}
      >
        <account.icon />
        <span className="min-w-0 flex-1 truncate">{account.label}</span>
        <ChevronDown className="text-muted-foreground" />
      </MenuTrigger>
      <MenuContent align="start" className="w-60">
        {rest.length > 0 && (
          <MenuGroup>
            {rest.map((view) => (
              <MenuItem key={view.id} onClick={view.onSelect}>
                <view.icon />
                <span className="min-w-0 flex-1 truncate">{view.label}</span>
                <MenuItemCheck checked={view.selected} />
              </MenuItem>
            ))}
          </MenuGroup>
        )}
        {(organizations.length > 0 || account.onCreate) && (
          <>
            {rest.length > 0 && <MenuSeparator />}
            <MenuGroup>
              <MenuGroupLabel>Organizations</MenuGroupLabel>
              {organizations.map((view) => (
                <div key={view.id} className="flex items-center gap-1">
                  <MenuItem className="min-w-0 flex-1" onClick={view.onSelect}>
                    <view.icon />
                    <span className="min-w-0 flex-1 truncate">{view.label}</span>
                    <MenuItemCheck checked={view.selected} />
                  </MenuItem>
                  {view.onSettings && (
                    <MenuItem className="shrink-0 justify-center" aria-label={`${view.label} settings`} title={`${view.label} settings`} onClick={view.onSettings}>
                      <Settings />
                      <span className="sr-only">{view.label} settings</span>
                    </MenuItem>
                  )}
                </div>
              ))}
              {account.onCreate && (
                <MenuItem onClick={account.onCreate}>
                  <Plus />
                  Create organization
                </MenuItem>
              )}
            </MenuGroup>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

function AccountMenu({ menu }: { menu: SidebarAccountMenu }) {
  return (
    <Menu>
      <MenuTrigger render={<SidebarMenuButton size="lg" aria-label="Account menu" title="Account menu" />}>
        <AvatarFrom avatar={menu.image ?? ""} label={menu.name} className="size-6" />
        <span className="min-w-0 flex-1 truncate">{menu.name}</span>
        <ChevronsUpDown className="text-muted-foreground" />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-(--anchor-width)">
        {menu.email && (
          <>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <AvatarFrom avatar={menu.image ?? ""} label={menu.name} className="size-7" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{menu.name}</span>
                <span className="truncate text-xs text-muted-foreground">{menu.email}</span>
              </div>
            </div>
            <MenuSeparator />
          </>
        )}
        <MenuGroup>
          {menu.items.map((item) => (
            <MenuItem key={item.label} onClick={item.onSelect}>
              <item.icon />
              {item.label}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}
