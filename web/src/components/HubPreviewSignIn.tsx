import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiError } from '@/lib/api-error';

async function previewRequest<T>(action: 'sign-in' | 'complete'): Promise<T> {
  const response = await fetch(`/api/preview/${action}`, {method:'POST', credentials:'omit'});
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? 'Could not sign in; try again.');
  return result;
}

export function HubPreviewSignIn() {
  const [approval, setApproval] = useState<{userCode:string;approvalUrl:string}>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      if (!approval) setApproval(await previewRequest('sign-in'));
      else {
        const result = await previewRequest<{status:string}>('complete');
        if (result.status === 'approved') window.location.reload();
        else if (result.status === 'expired' || result.status === 'denied') { setApproval(undefined); setError('Start signing in again.'); }
        else setError('Approve the code in Remy, then finish signing in.');
      }
    } catch (error) { setError(apiError(error)); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-svh items-center justify-center p-6">
    <section className="flex w-full max-w-sm flex-col gap-5">
      <h1 className="text-2xl font-semibold">Sign in to your preview</h1>
      <p className="text-sm text-muted-foreground">Use your live Remy account with the changes on this Mac.</p>
      {approval && <>
        <p aria-label="Sign-in code" className="text-center font-mono text-2xl">{approval.userCode}</p>
        <Button asChild><a href={approval.approvalUrl} target="_blank" rel="noreferrer">Approve in Remy</a></Button>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant={approval ? 'outline' : 'default'} disabled={busy} onClick={() => void run()}>{approval ? 'Finish signing in' : 'Sign in with Remy'}</Button>
    </section>
  </main>;
}
