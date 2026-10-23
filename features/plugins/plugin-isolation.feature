@id:plugin-isolation
Feature: Plugin isolation
  Each plugin runs in its own process, apart from core.
  The process may read only its own folder, and it gets only what its instance needs. It cannot take control of core.
  Core checks each message of the plugin. A broken or dead plugin fails the call, and core keeps running.

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

  Rule: A plugin cannot take control of core

    Scenario: A plugin that asks core to open its debugger finds none, and the admin is warned
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" signals core to open its debugger and tries to connect to it
      When agent 7 asks for the open tasks of "Groceries"
      Then Acme hears that the plugin found no debugger of core, and agent 7 gets "milk", "bread" and "eggs"
      And the audit log warns that core refused to open its debugger

  Rule: Broken plugin messages are rejected

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

    Scenario: A broken answer from the plugin fails the call, and core keeps running
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" answers each call with an error that has no details
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 is told that the plugin sent an answer that is not valid

    Scenario: A broken message that answers no call is ignored, and core keeps running
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" sends a log message without content
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs", and the server log notes that "tasks" sent a message that is not valid

    Scenario: Broken messages from one plugin are noted once a minute, and the repeats are counted
      Given Acme Tasks runs as the instance "tasks"
      When the plugin of "tasks" sends 50 log messages without content, and once more a minute later
      Then the server log notes once that "tasks" sent a message that is not valid, and a minute later counts 49 dropped repeats

    @backlog
    Scenario: A plugin that breaks the message channel itself does not stop core
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" writes a line that is not a message to its channel
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs", and the server log notes that a plugin broke its message channel

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
