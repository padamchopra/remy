import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ImageIcon, LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { ChatImageAttachment } from "@/state/types";

const MAX_IMAGES = 8;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

interface ImageItem {
  key: string;
  previewUrl: string;
  attachment?: ChatImageAttachment;
  uploading: boolean;
}

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

function valueOf(text: string, images: ImageItem[]): InlineImageComposerValue {
  const labels = images.map((_, index) => `<Image ${index + 1}>`);
  return {
    text: labels.length > 0 ? [text.trimEnd(), ...labels].filter(Boolean).join("\n\n") : text,
    attachments: images.flatMap((image) => image.attachment ? [image.attachment] : []),
    uploading: images.some((image) => image.uploading),
  };
}

export const InlineImageComposer = forwardRef<InlineImageComposerHandle, {
  ariaLabel: string;
  placeholder: string;
  initialText?: string;
  disabled?: boolean;
  onChange(value: InlineImageComposerValue): void;
  onSubmit(): void;
  onUpload(file: File): Promise<ChatImageAttachment>;
  onError(message: string): void;
}>(({
  ariaLabel,
  placeholder,
  initialText = "",
  disabled = false,
  onChange,
  onSubmit,
  onUpload,
  onError,
}, forwardedRef) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(initialText);
  const imagesRef = useRef<ImageItem[]>([]);
  const [text, setText] = useState(initialText);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [dragging, setDragging] = useState(false);

  const replace = (nextText: string, nextImages: ImageItem[]) => {
    textRef.current = nextText;
    imagesRef.current = nextImages;
    setText(nextText);
    setImages(nextImages);
    onChange(valueOf(nextText, nextImages));
  };

  useImperativeHandle(forwardedRef, () => ({
    clear() {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
      replace("", []);
    },
    focus() {
      textareaRef.current?.focus();
    },
  }));

  useEffect(() => () => {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
  }, []);

  const addFiles = (files: File[]) => {
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
      if (imagesRef.current.length + accepted.length >= MAX_IMAGES) {
        onError("You can attach up to 8 images.");
        break;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    const added: ImageItem[] = accepted.map((file) => ({
      key: key(),
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    }));
    replace(textRef.current, [...imagesRef.current, ...added]);
    accepted.forEach((file, index) => {
      const image = added[index];
      void onUpload(file).then((attachment) => {
        const next = imagesRef.current.map((current) =>
          current.key === image.key ? { ...current, attachment, uploading: false } : current);
        if (next.some((current) => current.key === image.key)) replace(textRef.current, next);
      }).catch((error) => {
        URL.revokeObjectURL(image.previewUrl);
        replace(textRef.current, imagesRef.current.filter((current) => current.key !== image.key));
        onError(error instanceof Error ? error.message : "That image didn't upload.");
      });
    });
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (pasted.length === 0) return;
    event.preventDefault();
    addFiles(pasted);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  };

  const removeImage = (image: ImageItem) => {
    URL.revokeObjectURL(image.previewUrl);
    replace(textRef.current, imagesRef.current.filter((current) => current.key !== image.key));
    textareaRef.current?.focus();
  };

  return (
    <>
      {images.length > 0 && (
        <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 pb-0">
          {images.map((image, index) => {
            const label = `Image ${index + 1}`;
            return (
              <HoverCard key={image.key} openDelay={180} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <Badge variant="secondary" className="gap-1.5">
                    {image.uploading ? <LoaderCircle className="animate-spin" /> : <ImageIcon />}
                    {label}
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${label}`}
                      onClick={() => removeImage(image)}
                    >
                      <X />
                    </Button>
                  </Badge>
                </HoverCardTrigger>
                <HoverCardContent side="top" align="start" className="w-72 space-y-2 p-2">
                  <img
                    src={image.previewUrl}
                    alt={image.attachment?.name ?? label}
                    className="max-h-52 w-full rounded-md bg-muted object-contain"
                  />
                  <p className="truncate px-1 pb-1 text-xs text-muted-foreground">
                    {image.attachment?.name ?? (image.uploading ? "Uploading image…" : label)}
                  </p>
                </HoverCardContent>
              </HoverCard>
            );
          })}
        </InputGroupAddon>
      )}
      <InputGroupTextarea
        ref={textareaRef}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        className={cn(
          "max-h-56 min-h-11",
          dragging && "bg-accent/40 ring-2 ring-ring/50",
        )}
        onChange={(event) => replace(event.target.value, imagesRef.current)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDragEnter={(event: DragEvent<HTMLTextAreaElement>) => {
          if ([...event.dataTransfer.items].some((item) => item.kind === "file")) setDragging(true);
        }}
        onDragLeave={(event: DragEvent<HTMLTextAreaElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDragOver={(event: DragEvent<HTMLTextAreaElement>) => {
          if (![...event.dataTransfer.items].some((item) => item.kind === "file")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event: DragEvent<HTMLTextAreaElement>) => {
          event.preventDefault();
          setDragging(false);
          addFiles([...event.dataTransfer.files]);
        }}
      />
    </>
  );
});

InlineImageComposer.displayName = "InlineImageComposer";
