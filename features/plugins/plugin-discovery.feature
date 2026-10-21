@id:plugin-discovery
Feature: Plugin discovery
  Core finds its plugins in the plugins folder of its data directory, at each start and at each rescan by the admin.
  Each folder with a manifest is one plugin, and the admin sees whether core can run it.

  Rule: Discovery sorts each plugin folder

    Scenario: The admin sees which plugins core can run
      Given the plugins folder holds a folder "broken" with a broken manifest
      And the plugins folder holds "Acme Tasks Next", which needs the plugin SDK ^2.0.0
      When the admin rescans the plugins folder
      Then the admin sees "broken" as not valid, Acme Tasks as ready to run, and "Acme Tasks Next" as not compatible

  Rule: The entry file must be inside its plugin folder

    Scenario: A plugin without its entry file is not valid
      Given the entry file of Acme Tasks is missing
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its entry file is not found

    Scenario: A plugin whose entry file links out of its folder is not valid
      Given the entry file of Acme Tasks is a link to a file outside its folder
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its entry file is outside its folder

  Rule: Agent instructions are read from the package

    Scenario: The instructions are read and trimmed
      Given Acme Tasks ships the agent instructions "docs/agent.md" with blank lines around "Keys are verbs."
      When the admin rescans the plugins folder
      Then the admin sees the agent instructions "Keys are verbs." for Acme Tasks

    Scenario: Missing instructions make the plugin not valid
      Given Acme Tasks names the agent instructions "docs/agent.md", but has no such file
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because "docs/agent.md" is not found

  Rule: Agent instructions are small text

    Scenario: Instructions over 4096 bytes make the plugin not valid
      Given Acme Tasks ships agent instructions of 4097 bytes
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its instructions are over 4096 bytes

    Scenario: Instructions that are not UTF-8 text make the plugin not valid
      Given Acme Tasks ships agent instructions that are not UTF-8 text
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its instructions are not UTF-8 text

  Rule: Agent instructions are not reached through a link

    Scenario: Instructions that link to a file in the package make the plugin not valid
      Given the agent instructions of Acme Tasks are a link to another file of Acme Tasks
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its instructions are a link

    Scenario: Instructions that link out of the package make the plugin not valid
      Given the agent instructions of Acme Tasks are a link to a file outside its folder
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its instructions are a link

    Scenario: Instructions in a folder that links out of the package make the plugin not valid
      Given the folder of the agent instructions of Acme Tasks is a link to a folder outside the package
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid, because its instructions are outside its folder

  Rule: An instructions change is audited by fingerprint only

    Scenario: Changed instructions are audited by their fingerprints
      Given Acme Tasks ships the agent instructions "Keys are verbs."
      And Acme Tasks now ships the agent instructions "Keys are nouns."
      When the admin rescans the plugins folder
      Then the audit log shows one change of the instructions of Acme Tasks, with the fingerprints before and after and no text

    Scenario: Unchanged instructions are not audited again
      Given Acme Tasks ships the agent instructions "Keys are verbs."
      When the admin rescans the plugins folder
      Then the audit log shows no change of the instructions of Acme Tasks

    Scenario: Emptied instructions are audited with no fingerprint after
      Given Acme Tasks ships the agent instructions "Keys are verbs."
      And Acme Tasks now ships empty agent instructions
      When the admin rescans the plugins folder
      Then the audit log shows one change of the instructions of Acme Tasks, with no fingerprint after

  Rule: New plugins start disabled, and a second folder with the same plugin is refused

    Scenario: A new plugin starts disabled
      Given the plugins folder holds "Acme Notes", a copy of Acme Tasks with its own id
      When the admin rescans the plugins folder
      Then the admin sees "Acme Notes" as ready to run, and disabled

    Scenario: A second folder with Acme Tasks is refused at the start
      Given the plugins folder holds a second folder with Acme Tasks
      When core restarts
      Then the admin sees one Acme Tasks, from its first folder
      And the admin sees the warning that a second Acme Tasks was ignored

  Rule: A plugin whose folder is gone is kept

    Scenario: A plugin whose folder disappears keeps its state and its instance
      Given Acme Tasks runs as the instance "tasks"
      And the folder of Acme Tasks is gone from the plugins folder
      When the admin rescans the plugins folder
      Then the admin sees Acme Tasks as not valid and still enabled, with the instance "tasks"
