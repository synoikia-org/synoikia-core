@id:plugin-install-and-update
Feature: Plugin install and update
  The admin installs a plugin from a repository at a version the admin picks.
  Core checks each build before it replaces any file, and a new or wider plugin waits for the admin.

  Background:
    Given core has no plugin copied into its plugins folder by hand
    And the admin added "Acme plugins", which offers Acme Tasks 1.0.0

  Rule: An install must match its checksum and the pinned signature

    Scenario: A build with its checksum and signature is installed
      When the admin installs Acme Tasks 1.0.0 from "Acme plugins"
      Then the admin has Acme Tasks 1.0.0 with a verified signature, disabled
      And the files of Acme Tasks 1.0.0 are in the plugins folder

    Scenario: A build that does not match its checksum is refused
      Given "Acme plugins" offers Acme Tasks 1.0.1 with the checksum of another build
      When the admin installs Acme Tasks 1.0.1 from "Acme plugins"
      Then the admin is told that the build does not match its checksum
      And the admin has no plugin Acme Tasks

    Scenario: A build with the signature of another build is refused
      Given "Acme plugins" offers Acme Tasks 1.0.2 with the signature of another build
      When the admin installs Acme Tasks 1.0.2 from "Acme plugins"
      Then the admin is told that the signature of the build is not valid
      And the admin has no plugin Acme Tasks

  Rule: An install needs a signature and a version that the index offers

    Scenario: A build without a signature is refused
      Given "Acme plugins" offers Acme Tasks 1.0.3 without a signature
      When the admin installs Acme Tasks 1.0.3 from "Acme plugins"
      Then the admin is told that the build has no signature
      And the admin has no plugin Acme Tasks

    Scenario: A version that the index does not offer is refused
      When the admin installs Acme Tasks 9.9.9 from "Acme plugins"
      Then the admin is told that "Acme plugins" does not offer that version
      And the admin has no plugin Acme Tasks

  Rule: A new install waits for the admin

    Scenario: The admin enables a new install and adds an instance
      Given the admin installed Acme Tasks 1.0.0 from "Acme plugins"
      When the admin enables Acme Tasks and adds the instance "tasks"
      Then "tasks" is ready with the 9 operations of Acme Tasks
      And the audit log shows that the admin enabled Acme Tasks

  Rule: An update stays enabled unless it widens what the plugin may do

    Scenario: An update with the same permissions keeps serving
      Given "tasks" runs on Acme Tasks 1.0.0 from "Acme plugins"
      And "Acme plugins" offers Acme Tasks 1.1.0
      When the admin installs Acme Tasks 1.1.0 from "Acme plugins"
      Then Acme Tasks 1.1.0 is enabled, and "tasks" is ready

    Scenario: An update that asks for one more network host waits for the admin
      Given "tasks" runs on Acme Tasks 1.0.0 from "Acme plugins"
      And "Acme plugins" offers Acme Tasks 1.2.0
      When the admin installs Acme Tasks 1.2.0 from "Acme plugins"
      Then Acme Tasks 1.2.0 is disabled, and "tasks" is stopped
      And the audit log shows that the update of Acme Tasks needs a review of its network hosts

  Rule: A plugin in use cannot be uninstalled

    Scenario: The admin cannot uninstall a plugin that an instance uses
      Given "tasks" runs on Acme Tasks 1.0.0 from "Acme plugins"
      When the admin uninstalls Acme Tasks
      Then the admin is told that the instance "tasks" uses Acme Tasks
      And the files of Acme Tasks 1.0.0 are in the plugins folder

    Scenario: The admin uninstalls a plugin after its last instance is deleted
      Given "tasks" runs on Acme Tasks 1.0.0 from "Acme plugins"
      And the admin deletes the instance "tasks"
      When the admin uninstalls Acme Tasks
      Then the files of Acme Tasks are gone from the plugins folder
      And the audit log shows that "Acme plugins" was added, then Acme Tasks installed, enabled and uninstalled

  Rule: Only the installing repository can replace a plugin

    Scenario: A second repository cannot replace a plugin from the first
      Given the admin installed Acme Tasks 1.0.0 from "Acme plugins"
      And the admin added "Acme mirror", which offers Acme Tasks 1.0.0
      When the admin installs Acme Tasks 1.0.0 from "Acme mirror"
      Then the admin is told that Acme Tasks is installed from another repository
      And "Acme mirror" offers Acme Tasks as installed from elsewhere

  Rule: The first repository install adopts a hand-copied plugin

    Scenario: An install from an unsigned repository adopts the hand-copied plugin
      Given the admin copied Acme Tasks 1.0.0 into the plugins folder by hand, and it runs as "tasks"
      And the admin added "Acme mirror", which offers Acme Tasks 1.1.0
      When the admin installs Acme Tasks 1.1.0 from "Acme mirror"
      Then Acme Tasks 1.1.0 is the same plugin, still has the instance "tasks", and is disabled for review
      And the audit log shows that "Acme mirror" adopted Acme Tasks

  Rule: Archives with links or paths outside the plugin are refused

    Scenario: An archive with a link to a system file is refused
      Given "Acme plugins" offers Acme Tasks 1.0.4 as an archive with a link to "/etc/passwd"
      When the admin installs Acme Tasks 1.0.4 from "Acme plugins"
      Then the admin is told that the archive is not valid
      And the admin has no plugin Acme Tasks

    Scenario: An archive with a path out of its folder is refused
      Given "Acme plugins" offers Acme Tasks 1.0.5 as an archive with the file "../escape.txt"
      When the admin installs Acme Tasks 1.0.5 from "Acme plugins"
      Then the admin is told that the archive is not valid
      And core wrote no file "escape.txt" outside the plugins folder

    Scenario: An archive without a manifest is refused
      Given "Acme plugins" offers Acme Tasks 1.0.6 as an archive without a manifest
      When the admin installs Acme Tasks 1.0.6 from "Acme plugins"
      Then the admin is told that the archive is not valid
      And the admin has no plugin Acme Tasks

  Rule: An archive must hold the version the admin picked

    Scenario: An archive that holds another version is refused
      Given "Acme plugins" offers Acme Tasks 1.0.7 as an archive of Acme Tasks 9.0.0
      When the admin installs Acme Tasks 1.0.7 from "Acme plugins"
      Then the admin is told that the archive holds Acme Tasks 9.0.0, not 1.0.7
      And the admin has no plugin Acme Tasks

  Rule: Archives over the limits are refused

    @long-running
    Scenario: An archive with more than 5000 entries is refused
      Given "Acme plugins" offers Acme Tasks 1.0.8 as an archive with 5001 entries
      When the admin installs Acme Tasks 1.0.8 from "Acme plugins"
      Then the admin is told that the archive is not valid
      And the admin has no plugin Acme Tasks

    Scenario: An archive that unpacks to more than 200 MB is refused
      Given "Acme plugins" offers Acme Tasks 1.0.9 as an archive that unpacks to 201 MB
      When the admin installs Acme Tasks 1.0.9 from "Acme plugins"
      Then the admin is told that the archive is not valid
      And the admin has no plugin Acme Tasks

    Scenario: An archive with a device file is refused
      Given "Acme plugins" offers Acme Tasks 1.0.10 as an archive with a device file
      When the admin installs Acme Tasks 1.0.10 from "Acme plugins"
      Then the admin is told that the archive is not valid
      And the admin has no plugin Acme Tasks

  Rule: Replacing plugin files is all or nothing

    @backlog
    Scenario: A failed swap keeps the old files
      Given "tasks" runs on Acme Tasks 1.0.0 from "Acme plugins"
      And the plugins folder cannot take the files of Acme Tasks 1.1.0
      When the admin installs Acme Tasks 1.1.0 from "Acme plugins"
      Then the files of Acme Tasks 1.0.0 are in the plugins folder, and no copy is left over
