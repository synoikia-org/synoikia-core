@id:portal-audit
Feature: The audit log in the portal
  The admin reads every call, search, change and sign-in in the audit log.
  Each event names who did it. Filters apply when the admin asks, and the log shows 100 events for each page.

  Rule: Each event names who did it

    Scenario: A person shows by name, and a deleted person is marked
      Given "bob" signed in once with the role "family" and was then deleted
      When the admin opens the audit log
      Then the sign-in of "bob" shows the actor "bob (deleted)"
      And the creation of "bob" shows the actor "admin"

    Scenario: A catalog sync shows the actor "system"
      Given the instance /tasks
      When the admin opens the audit log
      Then the catalog sync of /tasks shows the actor "system"

  Rule: Filters apply on Apply, and the log shows 100 events for each page

    Scenario: A kind filter waits for Apply
      Given the instance /tasks
      When the admin picks the kind "Sign-ins" in the audit log
      Then the audit log still shows the catalog sync
      And after Apply, it shows only sign-ins

    Scenario: The next page starts at event 101
      Given the admin made 105 roles
      When the admin opens the older events in the audit log
      Then the audit log shows events 101 and on of the total
