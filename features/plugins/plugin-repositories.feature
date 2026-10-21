@id:plugin-repositories
Feature: Plugin repositories
  A plugin repository publishes an index of plugins and their builds.
  The admin adds a repository, and core installs plugins only from repositories the admin added.
  A signed repository proves each build with the key that the admin confirmed.

  Rule: A signed repository is added only after the admin confirms its full key

    Scenario: The admin adds a signed repository without its key
      Given "Acme plugins" offers Acme Tasks 1.0.0
      When the admin adds "Acme plugins" as a signed repository without a key
      Then the admin is asked to confirm the key of "Acme plugins", and is shown its key id and its full key
      And the admin has no plugin repository

    Scenario: The admin confirms a key that is not the key of the repository
      Given "Acme plugins" offers Acme Tasks 1.0.0
      When the admin adds "Acme plugins" as a signed repository with another key
      Then the admin is asked to confirm the key of "Acme plugins", and is shown its key id and its full key
      And the admin has no plugin repository

    Scenario: The admin pastes the full key file of the repository
      Given "Acme plugins" offers Acme Tasks 1.0.0
      When the admin adds "Acme plugins" as a signed repository with its key file, comment line included
      Then the admin has the repository "Acme plugins" with its key id and 1 plugin

  Rule: A signed repository must publish a key

    Scenario: A repository that publishes no key cannot be added as signed
      Given "Acme plugins" offers Acme Tasks 1.0.0 but publishes no key
      When the admin adds "Acme plugins" as a signed repository without a key
      Then the admin is told that "Acme plugins" publishes no key
      And the admin has no plugin repository

  Rule: Only a secure address is fetched, on every hop

    Scenario: An address that is not secure is refused
      Given "Acme plugins" offers Acme Tasks 1.0.0
      When the admin adds the unsigned repository at "http://plugins.acme.example/index.json"
      Then the admin is told that core fetches only secure addresses
      And core never fetched "http://plugins.acme.example/index.json"

    Scenario: A repository that moved to another secure address is followed
      Given "Acme plugins" offers Acme Tasks 1.0.0
      And the address "https://old.acme.example/index.json" moved to "Acme plugins"
      When the admin adds the unsigned repository at "https://old.acme.example/index.json"
      Then the admin has the repository "Acme plugins" with 1 plugin

    Scenario: A move to an internal address that is not secure is refused
      Given the address "https://evil.acme.example/index.json" moves to "http://10.0.0.1:8080/admin"
      When the admin adds the unsigned repository at "https://evil.acme.example/index.json"
      Then the admin is told that core fetches only secure addresses
      And core never fetched "http://10.0.0.1:8080/admin"

  Rule: A repository that moves too often or does not answer is not added

    Scenario: A repository that moves seven times in a row is not added
      Given the address "https://loop.acme.example/0" moves seven times in a row
      When the admin adds the unsigned repository at "https://loop.acme.example/0"
      Then the admin is told that core could not fetch the repository
      And the admin has no plugin repository

    Scenario: A repository that does not answer is not added
      When the admin adds the unsigned repository at "https://down.example.net/index.json"
      Then the admin is told that core could not fetch the repository
      And the admin has no plugin repository

  Rule: An unknown index format is refused

    Scenario: An index in format version 2 is refused
      Given "Acme plugins" publishes its index in format version 2
      When the admin adds the unsigned repository at "https://plugins.acme.example/index.json"
      Then the admin is told that the index of the repository is not valid
      And the admin has no plugin repository

  Rule: A failed fetch is retried at the next refresh

    Scenario: A failed daily refresh shows its error
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And "Acme plugins" stopped publishing its index
      When a day passes and core refreshes its repositories
      Then the admin sees that the last fetch of "Acme plugins" failed

    Scenario: The next refresh retries a repository whose fetch failed
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And the last fetch of "Acme plugins" failed because it stopped publishing its index
      And "Acme plugins" publishes its index again
      When core refreshes its repositories
      Then the admin sees that the last fetch of "Acme plugins" worked

    Scenario: A repository fetched less than a day ago is not fetched again
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      When core refreshes its repositories
      Then core did not fetch the index of "Acme plugins" again

  Rule: The default repository is added once, pinned

    @long-running
    Scenario: The first start adds the default repository with its pinned key
      When the operator starts core for the first time
      Then the admin has the repository "Synoikia plugins", signed with the key that core pins
      And the audit log shows that core added "Synoikia plugins", not a person

    @long-running
    Scenario: A removed default repository is not added again
      Given the operator started core for the first time
      And the admin removed the repository "Synoikia plugins"
      When the operator starts core again
      Then the admin has no plugin repository

    @long-running
    Scenario: A default repository that the admin added already is not added twice
      Given the admin added "Synoikia plugins" with its pinned key
      When the operator starts core for the first time
      Then the admin has the repository "Synoikia plugins" once

  Rule: The default repository follows its move to a new address

    @long-running
    Scenario: Core moves the default repository from its former address
      Given the admin added "Synoikia plugins" at its former address with its pinned key
      When the operator starts core again
      Then the admin has the repository "Synoikia plugins", signed with the key that core pins
      And the admin has the repository "Synoikia plugins" once
      And the audit log shows that core moved "Synoikia plugins" to its new address, not a person

    @long-running
    Scenario: A repository at the former address with another key stays there
      Given the admin added "Synoikia plugins" at its former address with another key
      When the operator starts core again
      Then the admin still has a repository at the former address of "Synoikia plugins"

  Rule: A changed publisher key blocks installs

    Scenario: A refresh that finds a new key shows it to the admin
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And "Acme plugins" now signs with a new key
      When the admin refreshes "Acme plugins"
      Then the admin sees that the key of "Acme plugins" changed, and is shown the new key

    Scenario: An install from a repository whose key changed is refused
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And the key of "Acme plugins" changed
      When the admin installs Acme Tasks 1.0.0 from "Acme plugins"
      Then the admin is told that the key of the repository changed

    Scenario: A new key with the key id of the pinned key is still a new key
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And "Acme plugins" now signs with a new key that has the same key id
      When the admin refreshes "Acme plugins"
      Then the admin sees that the key of "Acme plugins" changed, and is shown the new key

  Rule: Only the new key unblocks installs

    Scenario: The admin confirms the old key again
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And the key of "Acme plugins" changed
      When the admin confirms the old key of "Acme plugins"
      Then the admin is asked to confirm the new key of "Acme plugins"
      And the admin sees that the key of "Acme plugins" changed, and is shown the new key

    Scenario: The admin confirms the new key
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And the key of "Acme plugins" changed
      And the admin confirmed the new key of "Acme plugins"
      When the admin installs Acme Tasks 1.0.0 from "Acme plugins"
      Then the admin has Acme Tasks 1.0.0 with a verified signature

    Scenario: The admin confirms the new key with the key id of the pinned key
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And "Acme plugins" now signs with a new key that has the same key id
      And the admin refreshed "Acme plugins"
      When the admin confirms the old key of "Acme plugins"
      Then the admin is asked to confirm the new key of "Acme plugins"

  Rule: A repository with installed plugins stays

    Scenario: The admin cannot remove a repository while a plugin from it is installed
      Given the admin installed Acme Tasks 1.0.0 from "Acme plugins"
      When the admin removes the repository "Acme plugins"
      Then the admin is told that Acme Tasks still comes from "Acme plugins"
      And the admin has the repository "Acme plugins" with 1 plugin

    Scenario: The admin removes a repository after the uninstall
      Given the admin installed Acme Tasks 1.0.0 from "Acme plugins"
      And the admin uninstalled Acme Tasks
      When the admin removes the repository "Acme plugins"
      Then the admin has no plugin repository

  Rule: The index is fetched daily, and only builds for this core are offered

    Scenario: A repository fetched more than a day ago is fetched again
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      When a day passes and core refreshes its repositories
      Then core fetched the index of "Acme plugins" again

    Scenario: A build that needs a newer core is not offered
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And "Acme plugins" offers Acme Tasks 1.1.0 for core 99.0.0 and newer
      When the admin looks at the plugins on offer
      Then the admin is offered Acme Tasks 1.0.0, and 1.1.0 is marked as not compatible

    Scenario: A build that needs a newer core is not installed
      Given the admin added "Acme plugins", which offers Acme Tasks 1.0.0
      And "Acme plugins" offers Acme Tasks 1.1.0 for core 99.0.0 and newer
      When the admin installs Acme Tasks 1.1.0 from "Acme plugins"
      Then the admin is told that Acme Tasks 1.1.0 needs a newer core
