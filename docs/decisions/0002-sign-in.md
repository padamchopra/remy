# D2: Use better-auth on D1

## Decision

The hub uses better-auth with Cloudflare D1. Its SSO plugin supports SAML and OIDC by launch.

## Consequences

Magic link and SSO are proven on Workers in H1. SSO ships in phase one because the first customers are mid-size organisations.

## Rejected alternatives

- A per-user hosted authentication service, because authentication must not add a per-seat infrastructure fee.
- Deferring SSO until after launch, because it would exclude the intended first customers.
- Supporting only one enterprise protocol, because launch requires both SAML and OIDC.
