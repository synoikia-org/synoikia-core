@id:manual-plugins
Feature: Manual plugins
  The admin can upload a build of a plugin, such as a build in development.
  Core stages the upload and shows what it replaces, and the admin then installs it.
  An uploaded build replaces the released version until the admin reverts to that version.

  Background:
    Given "tasks" runs on Acme Tasks 1.0.0 from "Acme plugins"

  Rule: An upload is staged and shows what it replaces

    Scenario: The admin uploads a development build
      When the admin uploads the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      Then the admin is shown Acme Tasks 1.1.0-dev.1 with its checksum, its file name and a compatible plugin SDK
      And the admin is shown that it replaces Acme Tasks 1.0.0 from "Acme plugins", enabled, with no permission changes

  Rule: An upload without permission changes keeps serving

    Scenario: The admin installs an upload with the same permissions
      Given the admin uploaded the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      When the admin installs the upload
      Then Acme Tasks 1.1.0-dev.1 is enabled and unverified, and marked as manual with the released version 1.0.0
      And "tasks" is ready, still reaches Acme with its token, and the audit log shows the manual install

    Scenario: An upload over a plugin from a signed repository still serves after a sync
      Given the admin installed the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      When the admin syncs "tasks"
      Then "tasks" is ready

    Scenario: The same upload cannot be installed twice
      Given the admin installed the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      When the admin installs the same upload again
      Then the admin is told that the upload is not there

  Rule: An upload that widens permissions, or a new plugin, starts disabled

    Scenario: An upload that asks for one more network host waits for the admin
      Given the admin uploaded a build of Acme Tasks 1.2.0-dev.1 that asks for one more network host
      When the admin installs the upload
      Then Acme Tasks 1.2.0-dev.1 is disabled, and "tasks" is stopped
      And the audit log shows that the manual install needs a review of its network hosts

    Scenario: An upload of a new plugin starts disabled
      Given the admin uploaded a build of the new plugin "Acme Notes" 0.1.0
      When the admin installs the upload
      Then Acme Notes 0.1.0 is disabled, comes from no repository, and has no released version

  Rule: Revert goes back to the released version

    Scenario: The admin reverts to the released version
      Given the admin installed the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      When the admin reverts Acme Tasks
      Then Acme Tasks 1.0.0 is enabled and no longer marked as manual
      And the audit log shows that the revert replaced "tasks-1.1.0-dev.1.tgz"

    Scenario: A plugin without a released version cannot be reverted
      Given the admin installed a build of the new plugin "Acme Notes" 0.1.0
      When the admin reverts Acme Notes
      Then the admin is told that the plugin has no released version to revert to

    Scenario: A released version that left the index cannot be reverted to
      Given the admin installed the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      And "Acme plugins" now offers only Acme Tasks 1.1.0
      When the admin reverts Acme Tasks
      Then the admin is told that Acme Tasks 1.0.0 is no longer in "Acme plugins"

  Rule: A repository install ends the manual build

    Scenario: An update from the repository clears the manual mark
      Given the admin installed the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      And "Acme plugins" offers Acme Tasks 1.1.0
      When the admin installs Acme Tasks 1.1.0 from "Acme plugins"
      Then Acme Tasks 1.1.0 is enabled and no longer marked as manual
      And the audit log shows that the update replaced "tasks-1.1.0-dev.1.tgz"

  Rule: Uploads over 50 MB are refused

    Scenario: An upload that declares more than 50 MB is refused
      When the admin uploads a file of 50 MB and 1 byte
      Then the admin is told that the file is too large

    Scenario: An upload that streams more than 50 MB without a size is refused
      When the admin streams a file of 51 MB without a size
      Then the admin is told that the file is too large

  Rule: An upload must be a built plugin archive

    Scenario: A file that is not an archive is refused
      When the admin uploads the text "not an archive at all" as "tasks.tgz"
      Then the admin is told that the archive is not valid

    Scenario: An archive with a link inside is refused
      When the admin uploads a build of Acme Tasks with a link to "/etc/passwd"
      Then the admin is told that the archive is not valid

    Scenario: A build without its entry file is refused
      When the admin uploads a build of Acme Tasks without its entry file
      Then the admin is told that the plugin is not valid

  Rule: An upload needs a plain file name

    Scenario: An upload without a file name is refused
      When the admin uploads a build of Acme Tasks without a file name
      Then the admin is told that the request is not valid

    Scenario: A file name with a folder path is refused
      When the admin uploads the build "../tasks.tgz" of Acme Tasks 1.1.0
      Then the admin is told that the request is not valid

    Scenario: A file name with a tab is refused
      When the admin uploads a build of Acme Tasks named "a", a tab, and "b.tgz"
      Then the admin is told that the file name is not valid

  Rule: A file name must show its real text

    Scenario: A file name with a right-to-left override is refused
      When the admin uploads a build of Acme Tasks named "acme-1.2.0", a right-to-left override, and "zgt.lave"
      Then the admin is told that the file name is not valid

    Scenario: A file name with a broken encoding is refused
      When the admin uploads a build of Acme Tasks with the encoded name "%E0"
      Then the admin is told that the file name is not valid

    Scenario: A file name with accented letters is accepted
      When the admin uploads the build "é.tgz" of Acme Tasks 1.1.0
      Then the admin is shown the file name "é.tgz"

  Rule: One staged upload at a time

    @exclusive
    Scenario: A second upload while the first one unpacks is refused
      When the admin uploads two builds of Acme Tasks at once
      Then the admin is told that another upload is being processed

    Scenario: A newer upload replaces the staged one
      Given the admin uploaded the build "tasks-1.1.0.tgz" of Acme Tasks 1.1.0
      And the admin uploaded the build "tasks-1.2.0.tgz" of Acme Tasks 1.2.0
      When the admin installs the first upload
      Then the admin is told that the upload is not there

  Rule: A staged upload lasts 15 minutes and does not survive a restart

    Scenario: An upload installed after 16 minutes has expired
      Given the admin uploaded the build "tasks-1.1.0.tgz" of Acme Tasks 1.1.0
      And 16 minutes pass
      When the admin installs the upload
      Then the admin is told that the upload expired
      And Acme Tasks 1.0.0 is still installed and enabled, with no manual install in the audit log

    Scenario: An upload is gone after a restart
      Given the admin uploaded the build "tasks-1.1.0.tgz" of Acme Tasks 1.1.0
      And core restarts
      When the admin installs the upload
      Then the admin is told that the upload is not there

  Rule: An upload must fit the plugin SDK of core and wait for a running install

    Scenario: An upload for a newer plugin SDK is refused
      Given the admin uploaded a build of Acme Tasks 1.1.0 for the plugin SDK ^9.0.0
      When the admin installs the upload
      Then the admin is told that the build needs the plugin SDK ^9.0.0

    Scenario: An upload waits for a repository install of the same plugin
      Given the admin uploaded the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      And a slow install of Acme Tasks 1.0.0 from "Acme plugins" runs
      When the admin installs the upload
      Then the admin is told that an install of Acme Tasks is in progress
      And the admin can install the upload once that install ends

  Rule: Only admins upload and revert

    Scenario: A user who is not an admin cannot upload
      Given user 12 has the role "family"
      When user 12 uploads the build "tasks-1.1.0.tgz" of Acme Tasks 1.1.0
      Then user 12 is told that only an admin can do this

    Scenario: A user who is not an admin cannot revert
      Given the admin installed the build "tasks-1.1.0-dev.1.tgz" of Acme Tasks 1.1.0-dev.1
      And user 12 has the role "family"
      When user 12 reverts Acme Tasks
      Then user 12 is told that only an admin can do this
