# Commit Message Rules

- Use English language.
- Use the Conventional Commits format:
  - `type(scope): summary`
  - `type: summary` only when there is no clear scope.
- Prefer a short, lowercase scope in parentheses. Do not use empty parentheses.
- Keep the summary under 72 characters.
- Write the summary in the imperative mood.
- Separate the summary from the body with a blank line.
- Explain motivation and contrast with previous behavior in the body when necessary.
- Reference issues or tickets if applicable.

## Types

- `feat` - a new user-facing feature.
- `fix` - a bug fix.
- `docs` - documentation-only changes.
- `chore` - maintenance work that does not affect runtime behavior.
- `refactor` - code changes that neither fix a bug nor add a feature.
- `test` - adding or updating tests.
- `build` - build system or dependency changes.
- `ci` - CI configuration changes.
- `perf` - performance improvements.
- `style` - formatting-only changes.

## Examples

- `feat(chat): add topic scheduling`
- `fix(triggers): handle replies without text`
- `docs(commits): describe commit message format`
- `chore(deps): update pnpm dependencies`
- `test(memory): cover summary cleanup`
