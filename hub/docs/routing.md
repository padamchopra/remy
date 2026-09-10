# Routing

WRK-17 and WRK-113–118 add ordered organization rules and per-member, per-workspace computer preferences. Settings → Routing edits the list and tests saved rules without allocating a computer. Rules match workspace, team and trigger; each selects a computer or a hosted/Mac/Linux class, optionally requiring emulator capability. The first eligible match wins. Hosted is the final fallback.

Eligibility always includes current membership, computer policy, workspace access, online state and compatible version. An explicit unavailable preference asks for another choice rather than silently moving the work. The composer works from organization workspaces, including when no computer is online, and allocates a separate hosted computer when you start a task using cloud execution. Hosting must be configured and enabled in Computers first.

The reference rule matches the Android workspace to an organization Mac mini with emulator capability. Browser QA creates a workspace, edits/tests this rule, starts a real daemon thread in the Android folder, and verifies separate member preferences. The fixture does not boot a physical Android emulator.

Both MCP paths expose read_routing and edit_routing through an exact GET/PUT /routing capability allowlist. The hub additionally requires its own recorded orchestrator-run binding on the authenticated computer and current administrator membership. A guest cannot mint this binding. WRK-19 creates those bindings when the hub starts the built-in orchestrator. Ordinary threads and separately configured external MCP clients are refused.

Apply migration 0011. Tests cover ordered matching, policy denial, offline/incompatible computers, emulator requirements, workspace identity and neighboring forbidden MCP routes. Live first-thread hosted allocation still depends on WRK-15's deployment gates.
