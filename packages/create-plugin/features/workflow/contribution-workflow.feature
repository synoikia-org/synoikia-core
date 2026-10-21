@id:contribution-workflow
Feature: Contribution workflow
  A plugin repository builds each change spec first and test first, as its docs/workflow.md says.
  Plugin author 3 runs "synoikia-plugin workflow" on the branch "acme-tasks/list-renaming", with "main" as the base.
  CI and the git hooks run the same checks.

  Background:
    Given plugin author 3 has the plugin repository "acme-plugins" with the plugin "acme-tasks" and the assistant files
    And the repository is a git repository with one commit on "main"
    And plugin author 3 works on the branch "acme-tasks/list-renaming"

  Rule: Branch names say where and what

    Scenario: A branch named for its component and its change passes
      When plugin author 3 checks the branch name
      Then the check passes

    Scenario: A branch for something that is not a component is refused
      When plugin author 3 checks the branch name "claude/list-renaming"
      Then the check fails with '"claude" is not a component. Use one of: acme-tasks, ci, docs, skills, deps'

    Scenario Outline: A name that does not say what changes is refused
      When plugin author 3 checks the branch name "<name>"
      Then the check fails with '<message>'

      Examples:
        | name                                    | message                                                      |
        | acme-tasks/serene-dijkstra-abei82       | "abei82" looks generated. Say what changes                   |
        | acme-tasks/rename                       | "rename" has 1 word. Use two to four                         |
        | acme-tasks/rename-and-archive-old-lists | "rename-and-archive-old-lists" has 5 words. Use two to four  |
        | acme-tasks/Rename-Lists                 | "Rename-Lists" is not lowercase kebab-case                   |
        | acme-tasks/rename-lists-20261018        | "rename-lists-20261018" contains a date                      |
        | acme-tasks/lists/rename-lists           | "acme-tasks/lists/rename-lists" is not <component>/<summary> |

  Rule: Feature files follow the house shape

    Scenario Outline: A feature file with the wrong shape is reported
      Given the branch adds the feature file "plugins/acme-tasks/features/lists/rename-lists.feature" with <flaw>
      When plugin author 3 checks the feature files
      Then the check fails with a problem that contains '<message>'

      Examples:
        | flaw                        | message                                      |
        | no id tag                   | the feature needs an @id:<kebab-case> tag    |
        | a scenario outside a rule   | put the scenario in a Rule                   |
        | a comment                   | no comments. Put it in the feature narrative |
        | the tag "@wip"              | @wip is not allowed                          |
        | the word "button" in a step | names a solution (button)                    |

    Scenario Outline: A scenario that is too long, unclear or broken is reported
      Given the branch adds the feature file "plugins/acme-tasks/features/lists/rename-lists.feature" with <flaw>
      When plugin author 3 checks the feature files
      Then the check fails with a problem that contains '<message>'

      Examples:
        | flaw                      | message                                                   |
        | a scenario of six steps   | has 6 steps. Use 5 at most                                |
        | a scenario with no Then   | needs one When and one Then                               |
        | the id of another feature | @id:rename-lists is also used at                          |
        | a line that is not a step | plugins/acme-tasks/features/lists/rename-lists.feature: ( |

    Scenario Outline: A branch that builds more than one slice is refused
      Given the branch adds the feature file "plugins/acme-tasks/features/lists/rename-lists.feature" with <scenarios>
      When plugin author 3 checks the feature files against "main"
      Then the check fails with a problem that contains '<message>'

      Examples:
        | scenarios                         | message                                              |
        | four scenarios in one rule        | this PR builds 4 scenarios. A slice is three at most |
        | one scenario in each of two rules | this PR builds scenarios of 2 rules                  |

  Rule: Each commit holds one phase, in order

    Scenario: A slice built spec, then test, then code passes
      Given the branch has the commits "spec: rename lists", "test: steps for rename lists" and "feat: rename lists"
      When plugin author 3 checks the phases of the branch against "main"
      Then the check passes

    Scenario Outline: A commit outside its phase is refused
      Given the branch has the commits <commits>
      When plugin author 3 checks the phases of the branch against "main"
      Then the check fails with a problem that contains '<message>'

      Examples:
        | commits                                       | message                                                            |
        | "rename lists"                                | start the subject with one of spec: arch: test:                    |
        | "spec: rename lists" with the plugin code     | plugins/acme-tasks/src/plugin.ts is outside the spec phase         |
        | "arch: rename lists" with the plugin code     | plugins/acme-tasks/src/plugin.ts is outside the arch phase         |
        | "spec: rename lists" and "feat: rename lists" | a feat: or fix: commit changes code with no test: commit before it |

    Scenario Outline: A commit that needs no red scenarios passes without a test commit
      Given the branch has the commits <commits>
      When plugin author 3 checks the phases of <mode> against "main"
      Then the check passes

      Examples:
        | commits                                       | mode         |
        | "refactor: share the list lookup"             | the branch   |
        | "docs: rename lists" with the plugin code     | the branch   |
        | "spec: rename lists" and "feat: rename lists" | the backfill |

  Rule: Prose on touched lines is short and plain

    Scenario Outline: An added line that breaks a writing rule is refused
      Given the branch adds to "docs/lists.md" <text>
      When plugin author 3 checks the prose against "main"
      Then the check fails with only 'docs/lists.md:3: <message>'

      Examples:
        | text                         | message                                          |
        | a sentence with a semicolon  | no semicolons. Write two sentences               |
        | a sentence with an em dash   | no em dashes. Write two sentences or use a colon |
        | a sentence of 26 words       | a sentence has 26 words. Use 25 at most          |
        | a table row with a semicolon | no semicolons. Write two sentences               |

    Scenario Outline: Code, front matter, links, comments and table rows are not sentences
      Given the branch adds to "docs/lists.md" <text>
      When plugin author 3 checks the prose against "main"
      Then the check passes

      Examples:
        | text                            |
        | a semicolon in inline code      |
        | a semicolon in a code block     |
        | a semicolon in the front matter |
        | a semicolon in a link target    |
        | a semicolon in a comment        |
        | a table row of 30 words         |

    Scenario: A line that the branch does not touch is not checked
      Given "docs/lists.md" on "main" has a sentence with a semicolon
      And the branch adds to "docs/lists.md" a sentence with an em dash
      When plugin author 3 checks the prose against "main"
      Then the check fails with only 'docs/lists.md:5: no em dashes. Write two sentences or use a colon'

  Rule: Security changes need a security line, and credentials never get committed

    Scenario Outline: A ready change to a security path needs a security line
      Given the branch has the commits "fix: tighten the list names" with the plugin code
      And the pull request is <state> with the description "<description>"
      When plugin author 3 checks the security line against "main"
      Then the check <result>

      Examples:
        | state   | description                                  | result                                                           |
        | ready   | Tightens the list names.                     | fails with a problem that contains 'Add a line "Security audit:' |
        | ready   | Security audit: list names only. No finding. | passes                                                           |
        | a draft | Tightens the list names.                     | passes                                                           |

    Scenario Outline: A credential file is refused at commit time
      Given plugin author 3 stages the file "<file>"
      When the commit hook runs
      Then the check fails with '<file> looks like a credential file. If it is tracked already: git rm --cached <file>'

      Examples:
        | file                        |
        | .env                        |
        | plugins/acme-tasks/acme.pem |
        | id_ed25519                  |

    Scenario Outline: A new test file must be a unit test
      Given the branch has the commits "test: list names" with the test file "<file>"
      When plugin author 3 checks the feature files against "main"
      Then the check <result>

      Examples:
        | file                                       | result                                                                                 |
        | plugins/acme-tasks/test/lists.test.ts      | fails with a problem that contains 'a new test file must be a pure-function unit test' |
        | plugins/acme-tasks/test/unit/names.test.ts | passes                                                                                 |

  Rule: Shared files sync safely

    Scenario: Shared files that are out of date are written again
      Given the shared file "docs/workflow.md" was changed by hand
      When plugin author 3 syncs the shared files
      Then "docs/workflow.md" matches the template again
      And the sync check reports nothing out of date

    Scenario: The git hooks are installed for the clone
      When plugin author 3 installs the git hooks
      Then git runs the hooks of the clone from ".githooks"

    Scenario: A sync through a link is refused
      Given "docs/workflow.md" is a link to a file outside the repository
      When plugin author 3 syncs the shared files
      Then the sync fails with "docs/workflow.md is a symlink. Remove it before the sync"
      And the file outside the repository is unchanged
