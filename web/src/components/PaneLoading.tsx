import { Spinner } from "@/components/ui/spinner";

export function PaneLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="flex h-48 w-full shrink-0 items-center justify-center">
      <Spinner aria-hidden="true" className="text-muted-foreground motion-reduce:animate-none" />
    </div>
  );
}
