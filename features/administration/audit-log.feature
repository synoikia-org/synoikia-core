@id:audit-log
Feature: Audit log
  Core records each call, search, sign-in and change of configuration in the audit log.
  The admin reads it with filters and exports it as a spreadsheet file.
  Each event names its actor, and a change of configuration shows what was there before and after, without secrets.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: Actors show by name
    Core records no other actor by the name admin. A unit test covers that filter case.

    Scenario: An admin change shows the admin, and agents and core show no user name
      Given agent 7 asks for the open tasks of "Groceries"
      When the admin reads the audit log
      Then the new credential of agent 7 shows the actor "admin", while the read of agent 7 and the first account show no user name

    Scenario: The filter "ADMIN" finds what the admin did
      Given agent 7 asks for the open tasks of "Groceries"
      When the admin filters the audit log by "ADMIN" and exports it
      Then both times the admin finds only what the admin did in the portal

  Rule: The export has every event once, newest first

    @long-running
    Scenario: An export of 2500 calls has each call once, newest first
      Given agent 7 tried 1250 counts and 1250 reads of "Groceries" in quick runs, while the group "lists" was off
      When the admin exports the calls of the audit log
      Then the export has 2500 calls, each once and newest first, and the export of the counts alone has 1250

  Rule: Each change of configuration is audited with before and after, without secrets

    Scenario: A change of a setting shows the old and the new value
      When the admin sets the idle limit of the portal to 45 minutes
      Then the audit log shows the idle limit 30 before and 45 after, under changes of configuration

    Scenario: The changes of a notification channel never show its token
      When the admin adds a notification channel with the token "tk_9f8e7d6c5b4a" and then gives it the token "tk_1a2b3c4d5e6f"
      Then the audit log shows both changes of the channel, but never a token
