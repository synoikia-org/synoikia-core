@id:scaffold
Feature: Scaffold
  Plugin author 3 starts a plugin repository with the create command.
  Plugin author 3 then adds plugins to it with "synoikia-plugin new".
  The tool writes only plain text that the author gives, and it never overwrites a file.

  Rule: A new plugin repository is complete and starts clean

    Scenario: A new repository has everything that a plugin repository needs
      Given plugin author 3 has an empty folder "acme-plugins"
      When plugin author 3 creates a plugin repository in "acme-plugins" for "acme/plugins" with the assistant files
      Then the repository has its hidden files, CI, the workflow checks, the git hooks, the assistant files and a plugins folder
      And the repository package names "acme/plugins", the scripts "new" and "workflow", and the ranges of core and the plugin tool
      And the repository has no release workflow and its shared workflow files are current

    Scenario: A repository without the assistant files has none of them
      Given plugin author 3 has an empty folder "acme-plugins"
      When plugin author 3 creates a plugin repository in "acme-plugins" for "acme/plugins"
      Then the repository has no assistant files and its shared workflow files are current

    Scenario Outline: A repository that cannot start clean is refused
      Given plugin author 3 has <folder>
      When plugin author 3 creates a plugin repository in "<name>" for "<repository>"
      Then the create command fails with "<message>"

      Examples:
        | folder                              | name         | repository   | message                              |
        | a folder "acme-plugins" with a file | acme-plugins | acme/plugins | is not empty                         |
        | an empty folder "Acme-Plugins"      | Acme-Plugins | acme/plugins | use a lowercase directory name       |
        | an empty folder "acme'plugins"      | acme'plugins | acme/plugins | use a lowercase directory name       |
        | an empty folder "acme-plugins"      | acme-plugins | acme plugins | repository must look like owner/name |

  Rule: A new repository guards what its plugins tell core
    A compliance profile, a fake upstream and a feature file decide what the compliance suite of core certifies.
    So a change to them is a security change, like a change to a plugin's policy.

    Scenario: The security paths of a new repository cover what certifies its plugins
      Given plugin author 3 has an empty folder "acme-plugins"
      When plugin author 3 creates a plugin repository in "acme-plugins" for "acme/plugins"
      Then the security paths of the repository cover each plugin's compliance profile, fake upstream, its fixtures, features and guides
      And they cover the shared test setting, the secret scan setting, the security reviewer, the assistant hooks and the lockfile

    Scenario: A new repository scans for secrets with the default rules
      Given plugin author 3 has an empty folder "acme-plugins"
      When plugin author 3 creates a plugin repository in "acme-plugins" for "acme/plugins"
      Then the repository has a secret scan setting that keeps the default rules

    Scenario: The assistant files of a new repository describe the compliance suite
      Given plugin author 3 has an empty folder "acme-plugins"
      When plugin author 3 creates a plugin repository in "acme-plugins" for "acme/plugins" with the assistant files
      Then the assistant files have the plugin development skill, and no assistant file names e2e tests or golden records

  Rule: A new plugin needs a valid id and namespace

    Background:
      Given plugin author 3 has the plugin repository "acme-plugins"

    Scenario: A plugin with a valid id is added and passes its checks
      When plugin author 3 adds the plugin "acme-tasks" named "Acme Tasks" for a REST service without a spec, with the key header "X-Token"
      Then the folder "plugins/acme-tasks" has a manifest, a package, plugin.yaml and the plugin code
      And the plugin sends the API key in the header "x-token"
      And the plugin package is "@synoikia/plugin-acme-tasks" and the plugin check reports no problems

    Scenario Outline: An invalid id or namespace is refused
      When plugin author 3 adds the plugin "<id>" with the namespace "<namespace>"
      Then the new command fails with '<message>'
      And the folder "plugins" is empty

      Examples:
        | id         | namespace | message                              |
        | Acme       | acme      | Plugin id: Use 2–63 lowercase letters |
        | a          | acme      | Plugin id: Use 2–63 lowercase letters |
        | acme-tasks | registry  | "registry" is reserved by core       |
        | acme-tasks | catalog   | "catalog" is reserved by core        |
        | acme-tasks | acme-box  | Must be a JavaScript identifier      |

  Rule: Names and headers cannot break the generated code, and a plugin is never overwritten

    Background:
      Given plugin author 3 has the plugin repository "acme-plugins"

    Scenario Outline: Text that could break out of the generated code is refused
      When plugin author 3 adds the plugin "acme-tasks" with the <field> "<text>"
      Then the new command fails with "<message>"
      And the folder "plugins" is empty

      Examples:
        | field       | text                        | message                       |
        | name        | Acme' + process.exit(1) + ' | Use letters, digits, spaces   |
        | name        | Acme <Tasks>                | Use letters, digits, spaces   |
        | description | Tasks `whoami`              | Use plain text without quotes |

    Scenario: An API key header with a line break is refused
      When plugin author 3 adds the plugin "acme-tasks" with an API key header that holds a line break
      Then the new command fails with "The API key header may only hold letters, digits and dashes"
      And the folder "plugins" is empty

    Scenario: An existing plugin is never overwritten
      Given the repository has the plugin "acme-tasks"
      When plugin author 3 adds the plugin "acme-tasks" named "Other Tasks" for a REST service without a spec, with the key header "X-Token"
      Then the new command fails with "plugins/acme-tasks already exists"
      And the manifest of "acme-tasks" still names "Acme Tasks"

  Rule: Every template passes its own checks

    Background:
      Given plugin author 3 has the plugin repository "acme-plugins"

    Scenario Outline: Each kind of sign-in gives a manifest with no secret field problems
      When plugin author 3 adds the plugin "acme-tasks" for a service with an OpenAPI description that uses <auth>
      Then the plugin check reports no problems
      And the plugin code has no unfilled placeholder, and the manifest still names the host "{{connection.baseUrl}}"

      Examples:
        | auth                |
        | a bearer token      |
        | an API key          |
        | a user and password |
        | no sign-in          |

    @long-running
    Scenario Outline: A new plugin of each kind checks, typechecks, builds and passes its own tests
      When plugin author 3 adds the plugin "acme-box" for <kind> that uses <auth>
      Then the plugin check, the type check, the build and the plugin tests of "acme-box" pass

      Examples:
        | kind                                    | auth           |
        | a service with an OpenAPI description   | a bearer token |
        | a REST service without a spec           | an API key     |
        | a remote procedure service on WebSocket | a bearer token |
        | a plugin to fill in by hand             | no sign-in     |

    @backlog
    Scenario: The tests of a plugin to fill in by hand are unit tests
      When plugin author 3 adds the plugin "acme-box" for a plugin to fill in by hand that uses no sign-in
      Then the tests of "acme-box" are in its unit test folder, where the workflow checks look for them

    @long-running
    Scenario Outline: A new plugin of each kind with a fake upstream is fit for production
      When plugin author 3 adds the plugin "acme-box" for <kind> that uses <auth>
      Then the compliance suite of core certifies "acme-box" 0.1.0 for production

      Examples:
        | kind                                    | auth                |
        | a service with an OpenAPI description   | a user and password |
        | a REST service without a spec           | no sign-in          |
        | a remote procedure service on WebSocket | a bearer token      |
