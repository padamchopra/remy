import { useEffect, useRef, useState } from "react";
import { Check, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { InputGroupButton } from "./ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
export function BranchName({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let copiedSynchronously = false;
    try {
      const input = document.createElement("textarea");
      input.value = branch;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.append(input);
      input.focus();
      input.select();
      input.setSelectionRange(0, branch.length);
      copiedSynchronously = document.execCommand("copy");
      input.remove();

      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);

      if (!copiedSynchronously) await navigator.clipboard.writeText(branch);
    } catch {
      if (!copiedSynchronously) {
        setCopied(false);
        toast.error("Couldn't copy the branch", { description: "Your browser blocked clipboard access." });
      }
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <InputGroupButton
          type="button"
          aria-label={`Copy branch ${branch}`}
          className="min-w-0 max-w-24 text-muted-foreground @2xl:max-w-40"
          onClick={() => void copy()}
        >
          <GitBranch />
          <span className="truncate">{branch}</span>
          {copied ? <Check /> : null}
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{copied ? "Copied" : branch}</TooltipContent>
    </Tooltip>
  );
}

