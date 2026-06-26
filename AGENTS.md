# Project Agent Instructions

## Official Documentation First

Before writing or modifying code, identify the languages, libraries, frameworks, build tools, and packages involved in the change. Consult their official documentation first, using the current project versions when available.

- Prefer official documentation, specifications, package docs, and repository docs from the maintainers over blogs, examples, or memory.
- For fast-moving dependencies, APIs, framework behavior, configuration, or syntax, verify the current official guidance before implementation.
- If official documentation is unavailable or insufficient, state that briefly and use the best primary source available.
- Keep the documentation check proportional to the change; small edits can use targeted lookups, while new features or dependency-sensitive work should include broader verification.
- Do not let documentation research replace local codebase inspection. Read the relevant project files and follow existing patterns before editing.

## Latest LTS Dependencies

When adding, upgrading, or choosing a runtime, language version, framework, library, package, or build tool, prefer the latest open source active LTS or officially recommended stable version from the maintainer.

- Verify LTS or recommended-stable status from official release notes, package metadata, or maintainer documentation before selecting a version.
- Do not choose prerelease, beta, nightly, experimental, or non-LTS, proprietary versions unless the user explicitly asks for them or the project already requires them.
- Preserve existing pinned versions when a task does not involve dependency selection or upgrades.
- If the latest LTS version conflicts with project constraints, compatibility, or acceptance criteria, state the conflict and choose the newest compatible stable version.
