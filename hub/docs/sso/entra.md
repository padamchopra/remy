# Connect Microsoft Entra ID

Register a web application in Microsoft Entra ID and add this redirect URI:

`https://tryremy.dev/api/auth/sso/callback/<provider-id>`

Create a client secret, then copy the tenant issuer, client ID, and secret into your organization's OpenID Connect settings. Request the `openid`, `profile`, and `email` scopes. The email claim must contain the person's verified organization address.

Verify the organization's email domain before enforcing single sign-on. Keep magic-link sign-in available until verification succeeds so an incorrect IdP configuration cannot lock everyone out.

Test with one assigned Entra user before enforcing the domain. After enforcement, anyone using a verified address on that domain is directed to Entra and cannot request a magic link.
