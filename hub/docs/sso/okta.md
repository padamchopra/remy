# Connect Okta

Create a SAML 2.0 application in Okta and use these values:

- Single sign-on URL: `https://tryremy.dev/api/auth/sso/saml2/callback/<provider-id>`
- Audience URI: the provider ID you choose in Remy
- Name ID format: EmailAddress
- Name ID: `user.email`

Send the email, first name, and last name attributes. Copy Okta's metadata URL into your organization's single sign-on settings, then verify the organization's email domain before enforcing single sign-on. Keep magic-link sign-in available until verification succeeds so an incorrect IdP configuration cannot lock everyone out.

Test with one assigned Okta user before enforcing the domain. After enforcement, anyone using a verified address on that domain is directed to Okta and cannot request a magic link.
