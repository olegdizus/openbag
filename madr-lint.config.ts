import { defineConfig } from 'madr-lint';

/**
 * madr-lint configuration.
 *
 * OpenBag uses MADR 4.0.0 with YAML frontmatter (see ADR-0000 and the
 * repo-skilled note `/memories/repo/adr-format-and-path.md`). ADRs live at
 * `docs/decisions/` (the canonical MADR path), not the tooling default
 * `docs/adr/`.
 *
 * Status enum is the strict MADR 4.0.0 set: proposed | rejected | accepted |
 * deprecated | `superseded by ADR-NNNN` (prefix). The default filename pattern
 * `^[0-9]{4}-.+\.md$` matches our `NNNN-kebab-slug.md` convention.
 */
export default defineConfig({
    extends: ['madr-lint:recommended'],
    madrVersion: 'v4',
    adrDir: 'docs/decisions',
    rules: {
        // Numbering gaps are intentionally allowed — ADRs get abandoned or
        // renumbered occasionally; we don't want the build to block on that.
        'madr/no-numbering-gap': 'off',
    },
});
