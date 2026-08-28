# Deployment environment rule

- Treat `backstagetest.meedoo.fun` (`69.164.253.58`) as the default environment for all code changes, configuration changes, builds, migrations, restarts, and deployment tests.
- Do not modify, restart, deploy to, or otherwise mutate the production environment at `backstage.meedoo.fun` (`162.35.168.250`) unless the user explicitly instructs you to publish or make the specified change in production.
- A request to change, fix, test, or deploy without explicitly naming production applies only to the test environment.
- Read-only production health checks are allowed when necessary to answer a production-status question, but they do not authorize mutations.
- An explicit production release instruction authorizes only that release and its necessary configuration steps; afterward, return to test-first behavior.
