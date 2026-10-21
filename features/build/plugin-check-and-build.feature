@id:plugin-check-and-build
Feature: Plugin check and build
  Plugin author 3 checks a plugin with "synoikia-plugin check" before a release.
  The check lists every problem that would block the release, not only the first one.
  "synoikia-plugin build" then bundles the plugin into one file that core starts.

  Rule: The check reports what blocks a release

    Background:
      Given plugin author 3 has the plugin repository "acme-plugins" with the plugin "acme-tasks" that signs in with a bearer token

    Scenario: Each problem of the manifest, plugin.yaml and the versions is reported
      Given the manifest of "acme-tasks" has the version "0.2.0" and lists no sensitive keys
      And plugin.yaml gives a rule the match profile "nope"
      When plugin author 3 checks the plugin "acme-tasks"
      Then the check fails and reports these problems:
        | connection.token: a secret field must be listed in sensitiveKeys  |
        | plugin.yaml rules[0]: matchProfile "nope" is not in the manifest  |
        | package.json version 0.1.0 and manifest.json version 0.2.0 differ |

    Scenario: A broken rules file is reported
      Given plugin.yaml has a rule with the unknown key "lockd"
      When plugin author 3 checks the plugin "acme-tasks"
      Then the check fails and reports a problem that starts with "plugin.yaml: "

    Scenario Outline: The instructions file must be present, small and inside the plugin
      Given the manifest of "acme-tasks" names the instructions file "<file>", which <state>
      When plugin author 3 checks the plugin "acme-tasks"
      Then the check <result>

      Examples:
        | file            | state                        | result                                                                              |
        | instructions.md | is missing                   | fails and reports "manifest.json: instructions instructions.md: not found"          |
        | instructions.md | holds 4097 bytes             | fails and reports "manifest.json: instructions instructions.md: is over 4096 bytes" |
        | instructions.md | is a link to another file    | fails and reports "manifest.json: instructions instructions.md: is a symbolic link" |
        | ../notes.md     | is outside the plugin folder | fails and reports a problem that starts with "manifest: instructions: "             |
        | instructions.md | holds a short guide          | passes                                                                              |

  Rule: The build bundles rules and guides into one file

    Background:
      Given plugin author 3 has a plugin "acme-tasks" whose code prints its plugin.yaml, its guide "guide.md" and its data file "lists.yaml"

    Scenario: The bundle holds plugin.yaml, the guide and the data file, and runs alone
      Given plugin.yaml says the greeting is "hello", the guide says "# Acme Tasks" and the data file lists "Groceries"
      When plugin author 3 builds the plugin "acme-tasks"
      Then the folder "plugins/acme-tasks/dist" holds only "index.js"
      And the bundle, run alone from another folder, prints "hello", "# Acme Tasks" and "Groceries"

    Scenario Outline: A data file that is not safe to inline stops the build
      Given <data file>
      When plugin author 3 builds the plugin "acme-tasks"
      Then the build fails with "<message>"
      And no bundle is written

      Examples:
        | data file                                                 | message                      |
        | plugin.yaml has the unknown section "rule"                | is not valid plugin settings |
        | the data file "lists.yaml" has an unclosed list           | lists.yaml                   |
        | the data file "lists.yaml" expands aliases 10 levels deep | Excessive alias count        |
