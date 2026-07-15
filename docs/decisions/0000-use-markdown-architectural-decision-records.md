---
status: "accepted"
date: 2026-07-14
decision-makers: Oleg Dizus
---

# Use Markdown Architectural Decision Records

## Context and Problem Statement

We want to record architectural decisions made in this project independent whether decisions concern the architecture ("architectural decision record"), the code, or other fields.
Which format and structure should these records follow?

## Considered Options

* [MADR](https://adr.github.io/madr/) 4.0.0 – The Markdown Architectural Decision Records
* [Michael Nygard's template](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions) – The first incarnation of the term "ADR"
* [Sustainable Architectural Decisions](https://www.infoq.com/articles/sustainable-architectural-design-decisions) – The Y-Statements
* Other templates listed at <https://github.com/joelparkerhenderson/architecture_decision_record>
* Formless – No conventions for file format and structure

## Decision Outcome

Chosen option: "MADR 4.0.0", because

* Implicit assumptions should be made explicit.
  Design documentation is important to enable people understanding the decisions later on.
  See also ["A rational design process: How and why to fake it"](https://doi.org/10.1109/TSE.1986.6312940).
* MADR allows for structured capturing of any decision.
* The MADR format is lean and fits our development style.
* The MADR structure is comprehensible and facilitates usage & maintenance.
* The MADR project is vivid.

## Consequences

* Every architectural decision in this repo is recorded as a `NNNN-kebab-slug.md`
  file under `docs/decisions/`, written in the strict MADR 4.0.0 shape.
* ADRs are validated by `madr-lint` (see `madr-lint.config.ts` at the repo
  root, and `pnpm lint:adr`). CI fails on missing required sections, an
  invalid `status`, a malformed `date`, broken cross-ADR links, or duplicate
  numbering.
* Conventions specific to this repo (H1 is the short title with no
  `ADR-NNNN:` prefix; the "Reinforced" blockquote pattern; relative-link
  cross-references) must be followed by every new ADR.

## Project-specific conventions

* The H1 is the **short title only**, without any `ADR-NNNN:` prefix — MADR
  encodes the number in the filename.
* To author a new ADR, copy the most recent existing one:
  `cp NNNN-….md $(printf '%04d' $((NNNN+1)))-short-kebab-title.md`.
* ADRs cross-reference each other by relative markdown link, e.g.
  `[ADR-0018](0018-core-and-split-into-separate-ui-and-api-workers.md)`.
* "Reinforced" is **not a status** — it is a leading body blockquote used when
  a later ADR strengthens (but does not replace) an earlier one, e.g.
  `> **Reinforced (YYYY-MM-DD) by [ADR-0018](…).** …`. The underlying
  `status:` in frontmatter stays `accepted`. The reverse direction carries a
  matching `> **Reinforces …**` blockquote in the newer ADR where useful.
