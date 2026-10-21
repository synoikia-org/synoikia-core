@id:catalog-sync-schedule
Feature: Catalog sync schedule
  Core syncs the catalog of an instance when the catalog may be old.
  It syncs before the first use, at a session start after an hour, when Acme reports a new version, and once a day.
  A sync that fails keeps the last good catalog.

  Rule: The catalog syncs before it is used

    Scenario: The first search on a new instance syncs its catalog first
      Given agent 7 belongs to the admin and may read and write
      And the admin added the instance "tasks" without a sync
      When agent 7 searches the catalog of "tasks"
      Then agent 7 finds the operation "show the open tasks"
      And the admin sees that "tasks" synced

    Scenario: A catalog older than one hour syncs when a session starts
      Given Acme Tasks runs as the instance "tasks"
      And agent 7 belongs to the admin and may read and write
      And Acme gets the saved view "Weekend", and 61 minutes go by
      When agent 7 searches the catalog of "tasks"
      Then agent 7 finds the saved view "Weekend"

    Scenario: An open session sees a new version of Acme after 30 minutes
      Given agent 7 of the admin has an open session on "tasks"
      And Acme moves to version "2.0" with the saved view "Weekend", and 31 minutes go by
      When agent 7 searches the catalog of "tasks"
      Then agent 7 finds the saved view "Weekend"

  Rule: A daily sync reaches the catalogs that nobody used

    Scenario: Each instance syncs one day after its own last sync
      Given "tasks" last synced 25 hours ago and "shopping" 2 hours ago
      When the hourly sync runs
      Then the admin sees that "tasks" synced again, and "shopping" did not

    Scenario: Two sessions that start at the same moment share one sync
      Given agent 7 belongs to the admin and may read and write
      And the admin added the instance "tasks" without a sync
      When agent 7 opens two sessions on "tasks" at the same moment
      Then Acme was asked for its catalog once

  Rule: A failed first sync shows an error until a sync works

    Scenario: A first sync that fails shows an error on the instance
      Given the plugin of "tasks" cannot list its operations
      And the admin added the instance "tasks" without a sync
      When the admin syncs "tasks", which fails
      Then the admin sees "tasks" with the error "First catalog sync failed: cannot read the catalog"

    Scenario: A good sync after a failed first sync makes the instance ready
      Given the plugin of "tasks" cannot list its operations
      And the admin added the instance "tasks" without a sync
      And the admin syncs "tasks", which fails
      When the plugin of "tasks" lists its operations again, and the admin syncs "tasks"
      Then the admin sees that "tasks" is ready

  Rule: A later failed sync keeps the last good catalog

    Scenario: The instance stays ready, and the admin gets a notification
      Given Acme Tasks runs as the instance "tasks"
      And the admin gets a notification when a sync fails
      When the admin syncs "tasks" while its plugin cannot list its operations
      Then the admin sees that "tasks" is ready
      And the admin got one notification "Catalog sync failed for /tasks"

    Scenario: A sync that the admin starts says what it added
      Given Acme Tasks runs as the instance "tasks"
      And Acme has 2 saved views
      When the admin syncs "tasks" now
      Then the admin is told that the sync added 2 operations
