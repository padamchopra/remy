# Git access for hosted computers

WRK-16 and WRK-109–112 provide smart HTTP clone/fetch/push through the hub. A hosted computer receives only a five-minute HMAC capability. GitHub's installation token remains on the hub: GitHub issues it for one hour, so returning it to the computer would not satisfy the five-minute boundary.

Create a GitHub App with only repository Contents read/write and required Metadata read. Install it on selected repositories. Configure GITHUB_APP_ID and the GITHUB_APP_PRIVATE_KEY Secret Store binding on the hub. After verifying the installation belongs to the intended organization, the deployment operator inserts its organization ID, installation ID and GitHub account into organization_git_installations. Installation IDs are unique across organizations; an organization administrator cannot claim an arbitrary installation through an API. Full OAuth installation onboarding belongs to WRK-22.

Apply migration 0010. An administrator configures exact writable branch names through PUT /api/organizations/:org/workspaces/:workspace/git with {"branches":["remy/release"]}; GET reads the policy. Default is read-only. Branch deletion, tags, unlisted refs and malformed receive-pack commands are rejected. GitHub branch protections still apply. Git LFS, submodule credential forwarding, push options and packs above 50 MB are not supported by this initial proxy.

The hosted bootstrap creates a repo-local executable credential helper, enables useHttpPath and sets origin to the credential-free hub URL. Initial fetch requests a read-only capability and checks out FETCH_HEAD. Future Git commands ask the hub for a fresh capability. The helper ignores store/erase and never writes tokens. Snapshot state contains the computer's existing identity and helper configuration, not GitHub credentials.

Every token request and proxy operation rechecks the immutable hub-managed computer/workspace binding. Guest-advertised capabilities cannot grant access to a second repository. Revoking a computer, removing its workspace or changing the branch policy takes effect on the next request. A copied capability cannot renew itself. At five minutes it is refused, even if a slow request began before expiry. An already forwarded operation can finish.

Tests cover expiry boundaries, tampering, repository normalization, multi-ref pushes, protected branches, deletes, tags, malformed packets, read-only writes and upstream redirects/header isolation. Live private-repository clone/push awaits a configured GitHub App installation. Keep the PR draft until that and hosted in-app evidence are available.

References: [GitHub installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [Git smart HTTP](https://git-scm.com/docs/http-protocol), [pack protocol](https://git-scm.com/docs/pack-protocol).
