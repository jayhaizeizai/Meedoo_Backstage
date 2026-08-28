# Deployment environment rule

- Treat `backstagetest.meedoo.fun` (`69.164.253.58`) as the default environment for all code changes, configuration changes, builds, migrations, restarts, and deployment tests.
- Do not modify, restart, deploy to, or otherwise mutate the production environment at `backstage.meedoo.fun` (`162.35.168.250`) unless the user explicitly instructs you to publish or make the specified change in production.
- A request to change, fix, test, or deploy without explicitly naming production applies only to the test environment.
- Read-only production health checks are allowed when necessary to answer a production-status question, but they do not authorize mutations.
- An explicit production release instruction authorizes only that release and its necessary configuration steps; afterward, return to test-first behavior.

# Lark application identity

- The test environment uses the dedicated Lark app ID `cli_aa1a6845a1f8de15`.
- Treat test and production Lark credentials as separate pairs. Never identify an app from an ID suffix; verify the complete App ID before changing credentials.
- Do not replace or infer the production Lark App ID or secret without an explicit production configuration instruction and the exact credential pair.
