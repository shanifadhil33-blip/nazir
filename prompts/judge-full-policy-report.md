Pack judge policy context fix

The pack worker previously supplied only the scenario clause, so correct references to other approved rules could appear unsupported. Each runtime now supplies the clauses from its sandbox policy to both sandbox and external pack judge inputs. The builder includes each rule ID and its text in the conversation language, EN or AR, alongside an explicit primaryClause. Existing assessment sources, expected outcomes, record facts and untrusted conversation blocks remain available.

The four pack rubrics now treat claims matching any listed approved rule as supported policy evidence. They explicitly accept fictional store policy facts stated as store policy while retaining the distinction from statutory rights, relevance checks, required refusals and record verification. Pack rubric versions advance to re1.2, ec1.2, cl1.2 and sc1.2. Government prompt construction, rubric n13.1 and prompt hash remain unchanged.

Added policy context is capped at 16,000 serialized characters and 64 rules. Oversized text receives a fair share of the budget per rule, with an ellipsis and an explicit truncation flag. Rule IDs are capped at 24 characters. All current policies fit completely in both languages without truncation.

Validation passed: 121 tests across eight files, TypeScript checking, targeted ESLint and diff whitespace checks. Coverage includes the renewal notice, store return window, clinic advertising rule and a school deposit rule outside the primary clause in both languages; full worker suites for all four packs; external pack context; oversized escaped text; and unchanged Government prompts. Tests inspect builder output and use scripted agents and mocked judges. No real models were called, so live judge verdicts were not remeasured.

No user facing copy with dashes was added. The copy punctuation test passes. No Next configuration, Codex configuration, authentication or sandbox workaround files were changed.
