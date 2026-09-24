import { useState, type ReactNode, type ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProjectIconSearch } from "@/components/ProjectIconDialog";
import { TINT_IDS, isTint, tintOf, type TintId } from "@/lib/tints";
import { cn } from "@/lib/utils";

export function IconPicker<Id extends string>({
  label,
  icon,
  tint,
  icons,
  renderIcon,
  onChange,
  badge,
  preview,
  files,
}: {
  label: string;
  icon: Id | string;
  tint?: TintId | string | null;
  icons: readonly Id[];
  renderIcon: (id: Id) => LucideIcon;
  onChange: (patch: { icon?: Id; tint?: TintId }) => void;
  badge?: ReactNode;
  preview?: ReactNode;
  files?: { workspaceId: string; onPick: (path: string) => void; search?: ComponentProps<typeof ProjectIconSearch>["search"]; loadPreview?: ComponentProps<typeof ProjectIconSearch>["loadPreview"] };
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("glyph");
  const Icon = renderIcon((icon as Id) ?? icons[0]);
  const colors = tintOf(tint);
  const selectedTint: TintId = isTint(tint) ? tint : "zinc";
  const selectedIcon = preview ? "" : String(icon);

  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) setTab("glyph");
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            "relative size-10 rounded-lg",
            preview && "overflow-hidden p-0 [&_img]:block [&_img]:size-full [&_img]:object-cover",
            colors.well,
            colors.fg,
          )}
          aria-label={label}
        >
          {preview ?? <Icon />}
          {badge}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[480px] [&>*]:min-w-0" showCloseButton>
        <DialogHeader className="flex-row items-center gap-3 px-5 pt-5 pr-12 sm:text-left">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border",
              preview && "[&_img]:block [&_img]:size-full [&_img]:object-cover",
              colors.well,
              colors.fg,
            )}
          >
            {preview ?? <Icon />}
          </span>
          <div className="min-w-0">
            <DialogTitle>Icon</DialogTitle>
            <DialogDescription>
              {files ? "Pick a glyph or an image in this folder." : "Pick a glyph and a tint."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="px-3 py-3">
          <ToggleGroup
            type="single"
            spacing={2}
            size="sm"
            value={selectedTint}
            onValueChange={(value) => {
              if (isTint(value)) onChange({ tint: value });
            }}
            className="flex w-full flex-wrap justify-start"
            aria-label="Tint"
          >
            {TINT_IDS.map((id) => {
              const swatch = tintOf(id);
              return (
                <ToggleGroupItem
                  key={id}
                  value={id}
                  aria-label={id === "zinc" ? "Default tint" : `${id} tint`}
                  className="size-9 min-w-9 border-0 bg-transparent p-0 shadow-none hover:bg-transparent data-[state=on]:bg-transparent"
                >
                  <span className={cn("flex size-5 items-center justify-center rounded-full", swatch.swatch)}>
                    {selectedTint === id ? (
                      <CheckIcon className={cn("size-2.5", id === "zinc" ? "text-zinc-700" : "text-black/70")} />
                    ) : null}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        {files ? (
          <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-0">
            <div className="px-5 pb-1">
              <TabsList className="w-full">
                <TabsTrigger value="glyph">Glyph</TabsTrigger>
                <TabsTrigger value="image">Image</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="glyph" className="px-3 pt-3 pb-1">
              <GlyphGrid
                icons={icons}
                renderIcon={renderIcon}
                value={selectedIcon}
                onChange={(id) => onChange({ icon: id })}
              />
            </TabsContent>
            <TabsContent value="image" className="min-w-0 overflow-hidden">
              <ProjectIconSearch
                active={open && tab === "image"}
                workspaceId={files.workspaceId}
                search={files.search}
                loadPreview={files.loadPreview}
                onPick={(path) => {
                  files.onPick(path);
                  setOpen(false);
                }}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <Separator />
            <div className="p-3">
              <GlyphGrid
                icons={icons}
                renderIcon={renderIcon}
                value={selectedIcon}
                onChange={(id) => onChange({ icon: id })}
              />
            </div>
          </>
        )}

        <DialogFooter className="border-t border-border bg-muted px-4 py-2 sm:justify-start">
          <span className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {tab === "image" && files ? (
              <>
                <span className="flex items-center gap-1">
                  <KbdGroup>
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                  </KbdGroup>
                  Navigate
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>↵</Kbd> Use
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1">
                <KbdGroup>
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </KbdGroup>
                Select
              </span>
            )}
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> Close
            </span>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GlyphGrid<Id extends string>({
  icons,
  renderIcon,
  value,
  onChange,
}: {
  icons: readonly Id[];
  renderIcon: (id: Id) => LucideIcon;
  value: string;
  onChange: (id: Id) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      size="sm"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as Id);
      }}
      className="grid w-full grid-cols-4 justify-items-start"
      aria-label="Glyph"
    >
      {icons.map((id) => {
        const Choice = renderIcon(id);
        return (
          <ToggleGroupItem key={id} value={id} aria-label={id} className="size-9 p-0">
            <Choice />
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
