@id:portal-plugins
Feature: Plugins in the portal
  The admin manages the installed plugins in the portal.
  A change that stops instances or deletes files asks first.
  An upload shows what it replaces before the admin installs it.
  A plugin from a file is marked, and the admin can go back to its released version.

  Rule: Disabling or uninstalling asks first

    Scenario: Disabling Acme Tasks names the instances it stops, and Cancel keeps it on
      Given the instances "groceries" and "errands" use Acme Tasks
      When the admin disables Acme Tasks in the portal and cancels the question
      Then the question said that this stops the 2 instances of "tasks"
      And Acme Tasks is still enabled

    Scenario: Uninstalling Acme Tasks says its files are deleted, then removes it
      Given Acme Tasks has no instances
      When the admin uninstalls Acme Tasks in the portal and confirms the question
      Then the question said "Its files are deleted."
      And the portal says "tasks uninstalled."
      And Acme Tasks is no longer installed

    Scenario: A rescan that fails shows the reason
      Given the server can no longer read its plugin folder
      When the admin rescans the plugins in the portal
      Then the portal shows the alert "Internal error"

  Rule: The admin sees which hosts a plugin contacts

    Scenario: A host from a connection field is explained, and a fixed host is shown as it is
      Given Acme Tasks contacts the host of its "Base URL" field and "sync.acme.example"
      When the admin opens the plugins in the portal
      Then Acme Tasks contacts "the host of each instance's Base URL", written as "{{connection.url}}"
      And Acme Tasks contacts "sync.acme.example"

  Rule: An upload shows what it replaces before the install

    Scenario: Acme Tasks 1.1.0 from a file replaces 1.0.0 and stays enabled
      Given Acme Tasks 1.0.0 from "Acme plugins" is installed and enabled
      When the admin uploads Acme Tasks 1.1.0 as "acme 1.1.0.tgz"
      Then the upload shows the version "1.1.0", its checksum and that it replaces "1.0.0 from Acme plugins"
      And the upload says "Only your review vouches for its code." and that Acme Tasks stays enabled
      And after the install, the portal says "tasks 1.1.0 installed."

    Scenario: A file that asks for one more host lists the change and disables the plugin
      Given Acme Tasks 1.0.0 from "Acme plugins" is installed and enabled
      When the admin uploads Acme Tasks 1.2.0, which also contacts "sync.acme.example"
      Then the upload lists the change "network.hosts"
      And the upload says "The plugin is disabled after the install."

    Scenario: A file with a new plugin says that it starts disabled
      When the admin uploads the new plugin "notes" 1.0.0
      Then the upload says "Nothing: this is a new plugin. It starts disabled."

  Rule: An upload that cannot be installed says why

    Scenario: A file that is too large is refused, and the admin can upload again
      When the admin uploads a file of 51 MB
      Then the upload says "The file is too large"
      And the admin can upload a file again

    Scenario: An upload older than 15 minutes has expired, and the admin uploads it again
      Given the admin uploaded Acme Tasks 1.1.0
      When the admin installs the upload 16 minutes later
      Then the upload says that it expired and asks for the file again
      And the admin can upload a file again

    Scenario: A file for a newer plugin kit cannot be installed
      When the admin uploads Acme Tasks 1.1.0 built for the plugin SDK "^0.9.0"
      Then the upload says that it needs plugin SDK "^0.9.0"
      And the admin cannot install it

  Rule: A plugin from a file is marked as manual

    Scenario: The manual plugin shows its checksum and its file name as plain text
      Given the admin installed the file "<b>acme.tgz" over Acme Tasks 1.0.0 from "Acme plugins"
      When the admin opens the plugins in the portal
      Then Acme Tasks is marked "manual", with the checksum of the file
      And the file name shows as the text "<b>acme.tgz"

    Scenario: A file over a plugin from no repository has no released version to go back to
      Given the admin installed the file "acme 1.1.0.tgz" over the hand-copied Acme Tasks
      When the admin opens the plugins in the portal
      Then Acme Tasks is marked "manual"
      And Acme Tasks offers no way back to a released version

  Rule: The admin can go back to the released version

    Scenario: Acme Tasks goes back from the file to 1.0.0 from "Acme plugins"
      Given the admin installed the file "acme 1.1.0.tgz" over Acme Tasks 1.0.0 from "Acme plugins"
      When the admin reverts Acme Tasks to its released version 1.0.0
      Then the question named "Acme plugins" as the source, without asking to type anything
      And the portal says "tasks 1.0.0 installed."

    Scenario: An unsigned repository is named in a warning, and a version it no longer offers is refused
      Given the admin installed the file "acme 1.1.0.tgz" over Acme Tasks 1.0.0 from "Acme mirror"
      And "Acme mirror" no longer offers Acme Tasks 1.0.0
      When the admin reverts Acme Tasks to its released version 1.0.0
      Then the question warned "This repository is unsigned", without asking to type anything
      And the question shows the alert "tasks@1.0.0 is no longer in Acme mirror"
