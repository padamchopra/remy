import { Fragment, type ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";

/// The strip across the top of the main pane.
///
/// Every pane uses this one, so a section and the thing you opened from it read
/// as the same kind of place — a list that titled itself with an `h1` and a
/// detail that titled itself with a breadcrumb looked like two different apps.
///
/// A crumb with `onClick` is the way back; the last is where you are. A crumb
/// whose label is already interactive — a picker, a tooltip — is passed as the
/// label and left alone.
export interface Crumb {
  label: ReactNode;
  onClick?: () => void;
}

export function PaneHeader({
  crumbs,
  /// Views of the same section, when it has more than one. Beside the crumbs
  /// rather than inside them: a tab strip is a place you go, not a place you
  /// have been, and a breadcrumb's last item is not something to click.
  tabs,
  selection,
  children,
}: {
  crumbs: Crumb[];
  tabs?: ReactNode;
  selection?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
      {selection ? selection : <>
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-1.5">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              // The separator is a sibling of the item, not a child: both are
              // `li`, and one inside the other is not a list.
              <Fragment key={index}>
                <BreadcrumbItem className="min-w-0">
                  {crumb.onClick ? (
                    <BreadcrumbLink asChild>
                      <Button type="button" data-link variant="ghost" size="sm" className="h-auto px-1" onClick={crumb.onClick}>
                        {crumb.label}
                      </Button>
                    </BreadcrumbLink>
                  ) : last ? (
                    <BreadcrumbPage className="max-w-[46ch] truncate font-semibold">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5">{crumb.label}</span>
                  )}
                </BreadcrumbItem>
                {!last && <BreadcrumbSeparator />}
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {tabs}
      {children && <div className="ml-auto flex shrink-0 items-center gap-3">{children}</div>}
      </>}
    </div>
  );
}
