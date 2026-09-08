import { getKv } from "./db.js";
import { connectionAuthorization } from "./hub-computer.js";
export async function hubAgentTool(
  chatId: string,
  action: string,
  input: unknown = {},
) {
  const registration = getKv<{
      organizationId: string;
      computerId: string;
      hubUrl: string;
    }>("hubComputerRegistration"),
    key = getKv<string>("hubComputerPrivateKey");
  if (!registration || !key)
    throw Error("This thread is not connected to your organization.");
  const response = await fetch(
    new URL(
      `/api/organizations/${encodeURIComponent(registration.organizationId)}/computers/agent-tools/${encodeURIComponent(chatId)}`,
      registration.hubUrl,
    ),
    {
      method: "POST",
      headers: {
        authorization: connectionAuthorization(
          registration.organizationId,
          registration.computerId,
          key,
        ),
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, input }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw Error("This agent cannot change your organization's routing.");
  return response.json();
}
