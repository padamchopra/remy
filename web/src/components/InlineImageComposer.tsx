import type {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
} from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ImageIcon, LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { ChatImageAttachment } from "@/state/types";

const MAX_IMAGES = 8;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

interface TextSegment {
  type: "text";
  key: string;
  text: string;
}

interface ImageSegment {
  type: "image";
  key: string;
  previewUrl: string;
  attachment?: ChatImageAttachment;
  uploading: boolean;
}

type Segment = TextSegment | ImageSegment;

export interface InlineImageComposerValue {
  text: string;
  attachments: ChatImageAttachment[];
  uploading: boolean;
}

export interface InlineImageComposerHandle {
  clear(): void;
  focus(): void;
}

function key(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function textSegment(text = ""): TextSegment {
  return { type: "text", key: key(), text };
}

function lengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node instanceof HTMLElement && node.dataset.imageKey) return 1;
  if (node instanceof HTMLBRElement) return 1;
  let length = 0;
  for (const child of node.childNodes) length += lengthOf(child);
  return length;
}

function selectionOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !root.contains(selection.anchorNode)) return lengthOf(root);
  const target = selection.anchorNode;
  const targetOffset = selection.anchorOffset;
  let offset = 0;
  let found = false;

  const visit = (node: Node) => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += Math.min(targetOffset, node.textContent?.length ?? 0);
      } else {
        for (let index = 0; index < Math.min(targetOffset, node.childNodes.length); index += 1) {
          offset += lengthOf(node.childNodes[index]);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return;
    }
    if (node instanceof HTMLElement && node.dataset.imageKey) {
      offset += 1;
      return;
    }
    if (node instanceof HTMLBRElement) {
      offset += 1;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };

  for (const child of root.childNodes) visit(child);
  return offset;
}

function restoreSelection(root: HTMLElement, wanted: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let remaining = Math.max(0, wanted);
  let placed = false;

  const visit = (node: Node) => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        placed = true;
      } else remaining -= length;
      return;
    }
    if (node instanceof HTMLElement && node.dataset.imageKey) {
      if (remaining === 0) {
        range.setStartBefore(node);
        placed = true;
      } else if (remaining === 1) {
        range.setStartAfter(node);
        placed = true;
      } else remaining -= 1;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };

  for (const child of root.childNodes) visit(child);
  if (!placed) range.selectNodeContents(root), range.collapse(false);
  else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertAt(segments: Segment[], offset: number, inserted: Segment[]): Segment[] {
  const next: Segment[] = [];
  let remaining = Math.max(0, offset);
  let done = false;
  for (const segment of segments) {
    if (done) {
      next.push(segment);
      continue;
    }
    const length = segment.type === "text" ? segment.text.length : 1;
    if (remaining > length) {
      next.push(segment);
      remaining -= length;
      continue;
    }
    if (segment.type === "text") {
      next.push(textSegment(segment.text.slice(0, remaining)), ...inserted, textSegment(segment.text.slice(remaining)));
    } else if (remaining === 0) next.push(...inserted, segment);
    else next.push(segment, ...inserted);
    done = true;
  }
  if (!done) next.push(...inserted);
  return next;
}

function readSegments(root: HTMLElement, known: Map<string, ImageSegment>): Segment[] {
  const next: Segment[] = [];
  let text = "";
  const flush = () => {
    if (text) next.push(textSegment(text));
    text = "";
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLElement && node.dataset.imageKey) {
      flush();
      const image = known.get(node.dataset.imageKey);
      if (image) next.push(image);
      return;
    }
    if (node instanceof HTMLBRElement) {
      text += "\n";
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of root.childNodes) visit(child);
  flush();
  return next.length > 0 ? next : [textSegment()];
}

function valueOf(segments: Segment[]): InlineImageComposerValue {
  let imageNumber = 0;
  let uploading = false;
  const attachments: ChatImageAttachment[] = [];
  const text = segments.map((segment) => {
    if (segment.type === "text") return segment.text;
    imageNumber += 1;
    if (segment.uploading) uploading = true;
    if (segment.attachment) attachments.push(segment.attachment);
    return `<Image ${imageNumber}>`;
  }).join("");
  return { text, attachments, uploading };
}

export const InlineImageComposer = forwardRef<InlineImageComposerHandle, {
  ariaLabel: string;
  placeholder: string;
  disabled?: boolean;
  onChange(value: InlineImageComposerValue): void;
  onSubmit(): void;
  onUpload(file: File): Promise<ChatImageAttachment>;
  onError(message: string): void;
}>(({
  ariaLabel,
  placeholder,
  disabled = false,
  onChange,
  onSubmit,
  onUpload,
  onError,
}, forwardedRef) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const segmentsRef = useRef<Segment[]>([textSegment()]);
  const pendingSelection = useRef<number | undefined>(undefined);
  const [segments, setSegments] = useState<Segment[]>(segmentsRef.current);
  const [dragging, setDragging] = useState(false);

  const replace = (next: Segment[]) => {
    segmentsRef.current = next;
    setSegments(next);
    onChange(valueOf(next));
  };

  useImperativeHandle(forwardedRef, () => ({
    clear() {
      for (const segment of segmentsRef.current) {
        if (segment.type === "image") URL.revokeObjectURL(segment.previewUrl);
      }
      replace([textSegment()]);
    },
    focus() {
      rootRef.current?.focus();
    },
  }));

  useEffect(() => () => {
    for (const segment of segmentsRef.current) {
      if (segment.type === "image") URL.revokeObjectURL(segment.previewUrl);
    }
  }, []);

  useLayoutEffect(() => {
    if (pendingSelection.current === undefined || !rootRef.current) return;
    restoreSelection(rootRef.current, pendingSelection.current);
    pendingSelection.current = undefined;
  }, [segments]);

  const insertText = (text: string) => {
    const root = rootRef.current;
    if (!root) return;
    const offset = selectionOffset(root);
    pendingSelection.current = offset + text.length;
    replace(insertAt(segmentsRef.current, offset, [textSegment(text)]));
  };

  const addFiles = (files: File[], offset: number) => {
    const currentImages = segmentsRef.current.filter((segment) => segment.type === "image").length;
    const accepted: File[] = [];
    for (const file of files) {
      if (!IMAGE_TYPES.has(file.type)) {
        onError("Use a PNG, JPEG, GIF, or WebP image.");
        continue;
      }
      if (file.size > MAX_BYTES) {
        onError("That image is larger than 10 MB.");
        continue;
      }
      if (currentImages + accepted.length >= MAX_IMAGES) {
        onError("You can attach up to 8 images.");
        break;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    const images: ImageSegment[] = accepted.map((file) => ({
      type: "image",
      key: key(),
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    }));
    pendingSelection.current = offset + images.length;
    replace(insertAt(segmentsRef.current, offset, images));
    accepted.forEach((file, index) => {
      const image = images[index];
      void onUpload(file).then((attachment) => {
        const next = segmentsRef.current.map((segment) =>
          segment.type === "image" && segment.key === image.key
            ? { ...segment, attachment, uploading: false }
            : segment,
        );
        if (next.some((segment) => segment.type === "image" && segment.key === image.key)) replace(next);
      }).catch((error) => {
        URL.revokeObjectURL(image.previewUrl);
        replace(segmentsRef.current.filter((segment) => segment.type !== "image" || segment.key !== image.key));
        onError(error instanceof Error ? error.message : "That image didn't upload.");
      });
    });
  };

  const moveCaretToPoint = (event: DragEvent<HTMLDivElement>) => {
    const documentAtPoint = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = documentAtPoint.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = position ? document.createRange() : documentAtPoint.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range) return;
    if (position) range.setStart(position.offsetNode, position.offset), range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const offset = selectionOffset(root);
    const known = new Map(
      segmentsRef.current
        .filter((segment): segment is ImageSegment => segment.type === "image")
        .map((segment) => [segment.key, segment]),
    );
    pendingSelection.current = offset;
    replace(readSegments(root, known));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.shiftKey) insertText("\n");
    else onSubmit();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    event.preventDefault();
    if (images.length > 0) addFiles(images, selectionOffset(event.currentTarget));
    else insertText(event.clipboardData.getData("text/plain"));
  };

  const removeImage = (image: ImageSegment) => {
    URL.revokeObjectURL(image.previewUrl);
    replace(segmentsRef.current.filter((segment) => segment.type !== "image" || segment.key !== image.key));
    rootRef.current?.focus();
  };

  const empty = valueOf(segments).text.length === 0;
  let imageNumber = 0;
  return (
    <div
      ref={rootRef}
      data-slot="input-group-control"
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-disabled={disabled}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-empty={empty ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-placeholder={placeholder}
      className={cn(
        "max-h-56 min-h-11 w-full min-w-0 flex-1 overflow-y-auto rounded-none border-0 bg-transparent px-3 py-3 text-base whitespace-pre-wrap break-words outline-none md:text-sm",
        "data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]",
        "data-[dragging=true]:bg-accent/40 data-[dragging=true]:ring-2 data-[dragging=true]:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDragEnter={(event) => {
        if ([...event.dataTransfer.items].some((item) => item.kind === "file")) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDragOver={(event) => {
        if (![...event.dataTransfer.items].some((item) => item.kind === "file")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        moveCaretToPoint(event);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        moveCaretToPoint(event);
        addFiles([...event.dataTransfer.files], selectionOffset(event.currentTarget));
      }}
    >
      {segments.map((segment) => {
        if (segment.type === "text") return <span key={segment.key}>{segment.text}</span>;
        imageNumber += 1;
        const label = `Image ${imageNumber}`;
        return (
          <HoverCard key={segment.key} openDelay={180} closeDelay={80}>
            <HoverCardTrigger asChild>
              <Badge
                contentEditable={false}
                data-image-key={segment.key}
                variant="secondary"
                className="mx-0.5 align-baseline select-none"
              >
                {segment.uploading ? <LoaderCircle className="animate-spin" /> : <ImageIcon />}
                {label}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" align="start" className="w-72 space-y-2 p-2">
              <img
                src={segment.previewUrl}
                alt={segment.attachment?.name ?? label}
                className="max-h-52 w-full rounded-md bg-muted object-contain"
              />
              <div className="flex min-w-0 items-center gap-2 px-1 pb-1">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {segment.attachment?.name ?? (segment.uploading ? "Uploading image…" : label)}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${label}`}
                  onClick={() => removeImage(segment)}
                >
                  <X />
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
});

InlineImageComposer.displayName = "InlineImageComposer";
