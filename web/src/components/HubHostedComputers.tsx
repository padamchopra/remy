import { useState } from "react";
import { HubCloudConnection } from "./HubCloudConnection";
import { HubModelAccess } from "./HubModelAccess";
import { Button } from "@/components/ui/button";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";

export function HubHostedComputers({organizationId, admin}: {organizationId:string; admin:boolean}) {
  const base = `${hubThreadBase(organizationId)}/hosted`;
  const resource = useHubResource<{available:boolean}>(organizationId,"/hosted");
  const [availability,setAvailability]=useState<boolean>();
  const [error,setError]=useState("");
  return <section aria-label="Cloud settings" className="flex w-full max-w-2xl flex-col gap-8">
    <HubCloudConnection key={organizationId} organizationId={organizationId} admin={admin}/>
    {resource.error && <p role="alert">{resource.error}</p>}
    {resource.value && !(availability ?? resource.value.available) && <div className="flex items-center gap-3"><p className="text-sm text-muted-foreground">Cloud computers are temporarily unavailable.</p><Button variant="outline" onClick={async()=>{try{const next=await hubRequest<{available:boolean}>(base);setAvailability(next.available);}catch{setError("Cloud availability could not be checked. Try again.");}}}>Check availability again</Button></div>}
    {admin && <HubModelAccess key={organizationId} organizationId={organizationId}/>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
