@id:plugin-isolation
Feature: Plugin isolation
  Each plugin runs in its own process, apart from core.
  The process may read only its own folder, and it gets only what its instance needs.
  Core checks each answer of the plugin. A broken or dead plugin fails the call, and core keeps running.

  Rule: A plugin reads only its own folder and gets only its own secrets

    Scenario: The plugin reads its own files and nothing else
      Given the plugin of "tasks" tells Acme what it can reach when it starts
      When the admin enables Acme Tasks and adds the instance "tasks"
      Then Acme hears that the plugin read its own manifest
      And Acme hears that the plugin could not read a system file or the files of core, and could not write a file

    Scenario: The plugin gets only its instance id, its run mode, its settings and its secrets
      Given the plugin of "tasks" tells Acme what it can reach when it starts
      When the admin enables Acme Tasks and adds the instance "tasks"
      Then Acme hears that the plugin got only "NODE_ENV" and "PLUGIN_INSTANCE_ID" from the environment of core
      And Acme hears that the plugin got the address "url" and the secret "token"

    Scenario: A plugin folder that is a link still starts
      Given the folder of Acme Tasks in the plugins folder is a link to another folder
      When the admin enables Acme Tasks and adds the instance "tasks"
      Then "tasks" is ready

  Rule: Broken plugin answers are rejected

    Scenario: A catalog that breaks the plugin contract is refused
      Given Acme Tasks runs as the instance "tasks"
      And the plugin of "tasks" sends an operation without its classification
      When the admin tries to sync "tasks"
      Then the admin is told that the sync failed, because the plugin sent a catalog that is not valid
      And the last sync of "tasks" shows the same reason

    Scenario: A plugin that does not know a method fails the call
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" no longer knows how to run a call
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 is told that the plugin failed with "method not found: invoke"

    Scenario: A plugin that never answers a call times out
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And core waits 1 second for each answer of the plugin of "tasks", which never answers
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 is told that the plugin did not answer in time

  Rule: A dead plugin fails calls at once

    Scenario: A plugin that dies during a read fails that call and the next one
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" dies when it is asked to run a call
      When agent 7 asks for the open tasks of "Groceries" twice in one run
      Then agent 7 is told both times that the plugin is not available

    Scenario: A disabled instance stops its plugin, and no crash is reported
      Given Acme Tasks runs as the instance "tasks"
      When the admin disables the instance "tasks"
      Then no process of Acme Tasks runs, and the audit log shows no plugin error
