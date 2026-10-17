# Contributing

How work moves from an idea to production. The project rules live in [AGENTS.md](AGENTS.md); behaviour comes from [docs/user-stories.md](docs/user-stories.md) and [docs/business-rules.md](docs/business-rules.md).

## 1. Branches and commits

- `main` is always releasable and protected: changes land only through a pull request with green CI and one approving review.
- Branch names: `feat/us-14-week-view`, `fix/two-step-logout`, `docs/…`, `chore/…`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`. Mention the story or rule ID when there is one (`feat(calendar): week view (US-14)`).

## 2. Pull requests and code review

- Fill in the [PR template](.github/pull_request_template.md). It is the Definition of Done.
- Keep PRs small (under ~400 changed lines where possible). Split schema changes from feature code.
- Reviewers check, in order: correctness against the story's acceptance criteria → tenant isolation and permissions → tests → readability.
- [CODEOWNERS](.github/CODEOWNERS) requests a review automatically for the sensitive areas.

## 3. CI gates (all must pass)

| Job | What it checks |
|---|---|
| `verify` | Prisma schema, lint, types, unit tests (≥ 90% domain coverage), integration tests, offline evals, build, browser tests (Chromium phone, WebKit iPhone, desktop), Lighthouse budget, dependency audit |
| `secrets-scan` | gitleaks: no keys or passwords committed |
| `CodeQL` | Static security analysis |
| `ai-evals` | Real-model eval gate, only when AI code changes (costs money) |

## 4. Versioning and releases

- [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Before 1.0 (the pilot), MINOR = new features, PATCH = fixes.
- Every user-visible change adds a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
- To release: move *Unreleased* to a new version heading, bump `package.json`, tag `vX.Y.Z`. The tag deploys to production after approval ([docs/operations.md](docs/operations.md)).
- Database migrations must work with the previous release still running (expand, then contract), so a release can be rolled back.

## 5. Changing a decision

Architecture decisions are recorded in [docs/adr/](docs/adr/). To change one, add a new ADR (or an amendment section) rather than silently changing the code. Scope and screen changes go in the product owner's private requirements and design documents.

## 6. Security issues

See [SECURITY.md](SECURITY.md). Don't open public issues for vulnerabilities.
