@id:housekeeping
Feature: Housekeeping
  Each hour, and at each start, core removes data that nobody needs any more.
  The audit log keeps its rows for 90 days by default. The admin can change that, or keep every row.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: Old data is cleaned each hour

    @backlog
    Scenario: Expired portal sessions and old hits of rules are removed
      Given the admin pre-approves adding any task to "Groceries" once an hour
      When the hourly clean-up runs 30 days later
      Then the data file holds no expired portal session and no rule hit older than an hour

    Scenario: An approval decided over 7 days ago is removed, and the audit log keeps it
      Given the app of agent 7 opens approval links
      And agent 7 adds "butter" to "Groceries", and the admin approves it on the page the app opened
      When the hourly clean-up runs 8 days later
      Then the approval link no longer opens
      And the audit log shows that the admin approved the add of "butter" on the approval page

  Rule: The audit log keeps rows for its retention

    Scenario: Rows older than 90 days are removed, and the removal is audited
      Given the admin made the user "user15@acme.example"
      When the hourly clean-up runs 91 days later
      Then the audit log no longer shows that the admin made the user "user15@acme.example"
      And the audit log shows that the clean-up removed old rows

    Scenario: With no retention, the audit log keeps every row
      Given the admin keeps the audit log forever
      And the admin made the user "user15@acme.example"
      When the hourly clean-up runs 91 days later
      Then the audit log still shows that the admin made the user "user15@acme.example"

    Scenario: A retention under 7 days is refused
      When the admin sets the retention of the audit log to 6 days
      Then the admin is told that the retention must be at least 7 days
