@id:admin-api-basics
Feature: Admin API basics
  The portal is a client of the Admin API, and so is any tool of the admin.
  The Admin API answers a bad request clearly and keeps working.
  Its overview shows the admin what they need to run core, and never shows approvals: those are decided only on the approval page.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"

  Rule: The Admin API answers clearly

    Scenario: A connection test that is not well formed is refused, and nothing breaks
      When the admin sends a connection test for "tasks" that is not well formed
      Then the admin is told that the request is malformed, and the next connection test of "tasks" works

    Scenario: An unknown request gets an answer as data, and a page of the portal opens the portal
      Given the portal app is installed
      When the admin asks the Admin API for something it does not have, and opens the portal page "/instances"
      Then the first answer is data that says "No such API route", and the second is the portal app

  Rule: Deleting an instance needs its typed name

    Scenario: A wrong typed name keeps the instance
      When the admin deletes "tasks" with the typed name "nope"
      Then the admin is told to type "tasks", and "tasks" still runs

    Scenario: The typed name deletes the instance
      When the admin deletes "tasks" with the typed name "tasks"
      Then the admin no longer has the instance "tasks"

  Rule: The overview shows what the admin needs and no approvals

    Scenario: The overview shows the version and the sign-in methods, and no approval
      Given agent 7 belongs to the admin and may read and write
      And the group "tasks" of "tasks" is at level ask
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin opens the overview
      Then the admin sees the version of core and the sign-in methods of "tasks", but no approval and no approval inbox

    Scenario: The open portal learns at once that a sync failed
      Given the admin has the portal open
      And the plugin of "tasks" cannot list its operations
      When the admin syncs "tasks", which fails
      Then the open portal gets the news that the sync of "tasks" failed
