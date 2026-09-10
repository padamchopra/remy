import { useCallback, useEffect, useState } from "react";
import { ClipboardPaste, FileUp, KeyRound, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
import type { Workspace } from "@/state/types";
import { toast } from "sonner";

interface EnvironmentVariable {
  name: string;
  configured: true;
  updatedAt: number;
}

interface WorkspaceEnvironment {
  id: string;
  name: string;
  active: boolean;
  variables: EnvironmentVariable[];
  updatedAt: number;
}

function CreateEnvironmentDialog({
  onCreate,
}: {
  onCreate(name: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate(name);
      setName("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus /> Add environment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Add environment</DialogTitle>
            <DialogDescription>Name the set of values this workspace can run with.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="environment-name">Name</FieldLabel>
            <Input
              id="environment-name"
              value={name}
              autoFocus
              maxLength={60}
              placeholder="Development"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || saving}>Add environment</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasteValuesDialog({ onImport }: { onImport(text: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await onImport(text);
      setText("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <ClipboardPaste /> Paste values
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Paste environment values</DialogTitle>
            <DialogDescription>Paste comma-separated or line-separated NAME=value pairs.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="environment-values">Values</FieldLabel>
            <Textarea
              id="environment-values"
              value={text}
              autoFocus
              rows={8}
              className="font-mono text-xs"
              placeholder="API_KEY=…&#10;DATABASE_URL=…"
              onChange={(event) => setText(event.target.value)}
            />
            <FieldDescription>Saved values cannot be viewed again.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={!text.trim() || saving}>Save values</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportFileDialog({
  files,
  onOpen,
  onImport,
}: {
  files: string[];
  onOpen(): Promise<void>;
  onImport(file: string, remove: boolean): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState("");
  const [saving, setSaving] = useState(false);
  const [remove, setRemove] = useState(true);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) void onOpen();
    else setFile("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || saving) return;
    setSaving(true);
    try {
      await onImport(file, remove);
      setOpen(false);
      setFile("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <FileUp /> Import .env
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Import an environment file</DialogTitle>
            <DialogDescription>Choose a .env file from this workspace.</DialogDescription>
          </DialogHeader>
          {files.length > 0 ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="environment-file">File</FieldLabel>
                <Select value={file} onValueChange={setFile}>
                  <SelectTrigger id="environment-file">
                    <SelectValue placeholder="Choose a file" />
                  </SelectTrigger>
                  <SelectContent>
                    {files.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="remove-environment-file">Remove after import</FieldLabel>
                  <FieldDescription>This keeps agents from reading the original file.</FieldDescription>
                </FieldContent>
                <Switch id="remove-environment-file" checked={remove} onCheckedChange={setRemove} />
              </Field>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
              Add a .env file to the workspace root, then try again.
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!file || saving}>Import values</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceEnvironmentSettings({ workspace }: { workspace: Workspace }) {
  const projects = useStore((state) => state.projects);
  const loadBoard = useStore((state) => state.loadBoard);
  const project = projects.find((entry) =>
    entry.workspaceIds.includes(workspace.id) || Boolean(workspace.origin && entry.origin === workspace.origin));
  const [environments, setEnvironments] = useState<WorkspaceEnvironment[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadBoard().catch(() => {});
  }, [loadBoard]);

  const load = useCallback(async () => {
    if (!project) return;
    const answer = await transport.request<{ environments?: WorkspaceEnvironment[] }>(
      workspace.serverId,
      `/projects/${encodeURIComponent(project.id)}/environments`,
    );
    setEnvironments(answer.environments ?? []);
    setLoading(false);
  }, [project, workspace.serverId]);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    void load().catch((error) => {
      setLoading(false);
      toast.error("Couldn't load the environments", { description: apiError(error) });
    });
    const refresh = setInterval(() => void load().catch(() => {}), 15_000);
    return () => clearInterval(refresh);
  }, [load, project]);

  if (!project) return null;
  const active = environments.find((entry) => entry.active) ?? environments[0];

  const create = async (name: string) => {
    try {
      await transport.request(workspace.serverId, `/projects/${encodeURIComponent(project.id)}/environments`, {
        method: "POST",
        body: { name },
      });
      await load();
      toast.success(`Added ${name.trim()}.`);
    } catch (error) {
      toast.error("Couldn't add the environment", { description: apiError(error) });
      throw error;
    }
  };

  const select = async (environmentId: string) => {
    try {
      await transport.request(workspace.serverId, `/projects/${encodeURIComponent(project.id)}/environments/active`, {
        method: "PUT",
        body: { environmentId },
      });
      await load();
    } catch (error) {
      toast.error("Couldn't change the environment", { description: apiError(error) });
    }
  };

  const importText = async (text: string) => {
    if (!active) return;
    try {
      await transport.request(
        workspace.serverId,
        `/projects/${encodeURIComponent(project.id)}/environments/${encodeURIComponent(active.id)}/import`,
        { method: "POST", body: { text } },
      );
      await load();
      toast.success(`Saved values to ${active.name}.`);
    } catch (error) {
      toast.error("Couldn't save the values", { description: apiError(error) });
      throw error;
    }
  };

  const loadFiles = async () => {
    try {
      const answer = await transport.request<{ files?: string[] }>(
        workspace.serverId,
        `/projects/${encodeURIComponent(project.id)}/environments/files`,
      );
      setFiles(answer.files ?? []);
    } catch (error) {
      toast.error("Couldn't find environment files", { description: apiError(error) });
    }
  };

  const importFile = async (file: string, remove: boolean) => {
    if (!active) return;
    try {
      await transport.request(
        workspace.serverId,
        `/projects/${encodeURIComponent(project.id)}/environments/${encodeURIComponent(active.id)}/import`,
        { method: "POST", body: { file, remove } },
      );
      await load();
      toast.success(`Imported ${file} into ${active.name}.`);
    } catch (error) {
      toast.error("Couldn't import the file", { description: apiError(error) });
      throw error;
    }
  };

  const removeVariable = async (name: string) => {
    if (!active) return;
    try {
      await transport.request(
        workspace.serverId,
        `/projects/${encodeURIComponent(project.id)}/environments/${encodeURIComponent(active.id)}/variables/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      await load();
      toast.success(`Removed ${name}.`);
    } catch (error) {
      toast.error("Couldn't remove the value", { description: apiError(error) });
    }
  };

  const removeEnvironment = async () => {
    if (!active) return;
    try {
      await transport.request(
        workspace.serverId,
        `/projects/${encodeURIComponent(project.id)}/environments/${encodeURIComponent(active.id)}`,
        { method: "DELETE" },
      );
      await load();
      toast.success(`Removed ${active.name}.`);
    } catch (error) {
      toast.error("Couldn't remove the environment", { description: apiError(error) });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <Field orientation="responsive" className="items-start">
        <FieldContent>
          <FieldLabel>Environment</FieldLabel>
          <FieldDescription>Your tasks use the selected values on this computer; shared environments are managed in Settings.</FieldDescription>
        </FieldContent>
        <CreateEnvironmentDialog onCreate={create} />
      </Field>

      {loading ? (
        <p className="shimmer rounded-lg border border-border px-3.5 py-3 text-sm text-muted-foreground">
          Reading environments…
        </p>
      ) : environments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
          Add an environment before saving values.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={active?.id} onValueChange={(value) => void select(value)}>
              <SelectTrigger aria-label="Active environment" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {environments.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ImportFileDialog files={files} onOpen={loadFiles} onImport={importFile} />
            <PasteValuesDialog onImport={importText} />
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${active?.name}`} className="ml-auto text-muted-foreground hover:text-destructive">
                      <Trash2 />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Remove environment</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {active?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>Its saved values are removed from every connected device.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void removeEnvironment()}>Remove environment</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {active?.variables.length ? (
            <ItemGroup className="gap-2">
              {active.variables.map((variable) => (
                <Item key={variable.name} variant="outline" size="sm">
                  <ItemMedia variant="icon"><KeyRound /></ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-mono">{variable.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="secondary">Stored</Badge>
                    <AlertDialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${variable.name}`} className="text-muted-foreground hover:text-destructive">
                              <Trash2 />
                            </Button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Remove value</TooltipContent>
                      </Tooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {variable.name}?</AlertDialogTitle>
                          <AlertDialogDescription>This value stops being available to runtime commands.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => void removeVariable(variable.name)}>Remove value</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
              Import a .env file or paste values for this environment.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Exact values are hidden in output, but encoded or transformed values cannot be detected.
          </p>
        </div>
      )}
    </section>
  );
}
