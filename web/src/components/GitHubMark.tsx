import { cn } from "@/lib/utils";

/// GitHub's mark, for the places Remy hands you to GitHub. Drawn in
/// `currentColor` so it takes the colour of the control it sits in.
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={cn("size-4 shrink-0", className)}>
      <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.03-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .94-.3 3.1 1.15A10.8 10.8 0 0 1 12 6.16c.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.33-2.64 5.29-5.15 5.56.41.35.77 1.03.77 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75z" />
    </svg>
  );
}
