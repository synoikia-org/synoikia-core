@id:repository-release-check
Feature: Repository release check
  Before a plugin repository publishes a release, its author checks the release with the core testing package.
  The check installs the newest build of each plugin the way core does, with the key that admins pin, and then starts each plugin.
  The check stops at the first failure and names the plugin and the version.

  Rule: A release is checked against the pinned key, and each plugin starts

    Scenario Outline: The check installs Acme Tasks from <links> download addresses, with its signature verified
      Given "Acme plugins" offers Acme Tasks 1.0.0 with <links> download addresses
      When plugin author 3 checks the release of "Acme plugins" with its key
      Then the check passes for Acme Tasks 1.0.0, with its signature verified

      Examples:
        | links    |
        | relative |
        | full     |

    Scenario Outline: The check fails when <case>
      Given <offer>
      When plugin author 3 checks the release of "Acme plugins" with <key>
      Then <outcome>

      Examples:
        | case                         | offer                                                                      | key         | outcome                                                                 |
        | the key is another key       | "Acme plugins" offers Acme Tasks 1.0.0                                     | another key | the check fails, because the key is not the key of "Acme plugins"       |
        | the archive changed          | "Acme plugins" offers Acme Tasks 1.1.0 with the checksum of another build | its key     | the check fails for Acme Tasks 1.1.0, because the checksum does not match |
        | the archive is missing       | "Acme plugins" offers Acme Tasks 1.0.0 without its archive                 | its key     | the check fails for Acme Tasks 1.0.0, because its archive is missing    |

    @long-running
    Scenario Outline: The check fails when Acme Tasks <fault>
      Given "Acme plugins" offers a build of Acme Tasks 1.0.0 that <fault>
      When plugin author 3 checks the release of "Acme plugins" with its key
      Then <outcome>

      Examples:
        | fault                      | outcome                                                          |
        | throws "boom" when it loads | the check says that Acme Tasks 1.0.0 does not start, and shows "boom" |
        | never answers              | the check says that Acme Tasks 1.0.0 does not start              |
