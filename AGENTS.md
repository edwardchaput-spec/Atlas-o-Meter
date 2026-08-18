# Project working agreement

## Working style

- Begin substantial work with a written plan.
- Break the roadmap into small, testable milestones.
- Explain important architectural choices in plain English.
- Prefer maintainable, conventional solutions over clever ones.
- Keep the application runnable at the end of every milestone.

## Engineering standards

- Use TypeScript with strict type checking unless the approved architecture requires something else.
- Use pnpm for JavaScript dependencies.
- Keep secrets out of Git.
- Maintain an accurate .env.example without real credentials.
- Validate input at all trust boundaries.
- Include responsive design and accessibility.
- Include meaningful automated tests.
- Run formatting, linting, type checking and tests after changes.
- Fix failures rather than ignoring or suppressing them.

## Safety boundaries

- Work only inside this repository unless explicitly instructed otherwise.
- Do not modify SSH, Proxmox, host networking or operating-system configuration.
- Do not install system packages.
- Do not expose development services to the public Internet.
- Do not push to a remote repository without approval.
- Do not rewrite Git history.
- Do not run destructive database operations without approval.
- Do not include credentials, tokens or private keys in source files, logs or commits.

## Documentation

Keep these documents current as the project develops:

- docs/product-spec.md
- docs/architecture.md
- docs/data-model.md
- docs/roadmap.md
- docs/testing.md
- README.md
