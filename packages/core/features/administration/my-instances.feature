@id:my-instances
Feature: My instances
  A user sees the instances of their role in the portal, with what they can call on each.
  The switches of the role on each instance let them see its status, set their own levels and write their own rules.
  Another instance can at most be named to them, and never reached.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And user 12 has the role "family", which has the instance "tasks"
    And agent 9 belongs to user 12 and may read and write

  Rule: A user sees only the instances of their role

    Scenario: User 12 sees "tasks" with what they can call, and no status
      Given Acme Tasks also runs as the instance "shopping"
      And the admin sets the maximum of "family" for the group "lists" to read
      When user 12 looks at their instances
      Then user 12 sees only "tasks", with the reads they can call and no status, and "shopping" is not found

    Scenario: With the status switch, user 12 sees the status and every operation
      Given the role "family" lets its users see the status of "tasks"
      When user 12 looks at their instances
      Then user 12 sees the status of "tasks" and every operation, each one that is off with its reason

  Rule: Each switch works only on its own instance

    Scenario: Own levels on "shopping" do not open own levels on "tasks"
      Given Acme Tasks also runs as the instance "shopping"
      And the admin gives "family" the instance "shopping" as well
      And the role "family" lets its users set their own levels on "shopping"
      When user 12 sets their own level of the group "lists" to none on "shopping" and on "tasks"
      Then it works on "shopping" and is refused on "tasks"

    Scenario: With the switch off, own levels stop counting and are kept
      Given the admin sets the maximum of "family" for the group "lists" to read
      And the role "family" lets its users set their own levels on "tasks"
      And user 12 sets their own level of "show the open tasks" to none
      When the admin turns off own levels for "family" on "tasks"
      Then agent 9 gets the open tasks of "Groceries" again, and the own level of user 12 counts again with the switch on

  Rule: Other instances can be named, never reached

    Scenario: Without the switch, no other instance is shown
      Given Acme Tasks also runs as the instance "shopping"
      When user 12 looks at their instances
      Then user 12 is shown no other instances

    Scenario: With the switch, "shopping" is named but cannot be reached
      Given Acme Tasks also runs as the instance "shopping"
      And the role "family" lets its users see other instances
      When user 12 looks at "shopping"
      Then user 12 sees the name, plugin and description of "shopping", but no levels and no credential, and agent 9 is refused there

    Scenario: An admin has no other instances
      Given Acme Tasks also runs as the instance "shopping"
      When the admin looks at their instances
      Then the admin is shown no other instances

  Rule: Own levels go up to the role maximum

    Scenario: An own level above the role maximum is refused, and a cleared own level follows the role
      Given the role "family" lets its users set their own levels on "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      When user 12 tries the own levels write, none and no own level for the group "tasks"
      Then only write is refused, and "add a task" follows the role at ask

    Scenario: An own ask on a read stays when the admin lowers the maximum
      Given the role "family" lets its users set their own levels on "tasks"
      And the admin sets the maximum of "family" for the group "lists" to ask
      And user 12 sets their own level of "show the open tasks" to ask
      When the admin sets the maximum of "family" for the group "lists" to read
      Then user 12 still sees "show the open tasks" at ask

    Scenario: An own level on an operation that the role does not reach is refused
      Given the role "family" lets its users set their own levels on "tasks"
      And the role "family" lets its users see the status of "tasks"
      When user 12 tries to set their own level of "add a task" to ask
      Then user 12 is told that their role allows at most none for "add a task"

  Rule: Own rules belong to their owner

    Scenario: User 12 changes only their own rule, and the admin sees who owns it
      Given the role "family" lets its users write their own rules on "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      And the admin pre-approves adding any task to "Groceries"
      When user 12 pre-approves adding any task to "Groceries"
      Then user 12 can change only their own rule, and the admin sees user 12 as its owner

    Scenario: A rule on an operation that user 12 cannot call is refused
      Given the role "family" lets its users write their own rules on "tasks"
      When user 12 tries to pre-approve adding any task to "Groceries"
      Then user 12 is told that they can write rules only for what they can call

  Rule: The rule editor offers only what the user may write rules for

    Scenario: User 12 gets the lists to pick, without what Acme keeps on them
      Given the role "family" lets its users write their own rules on "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      When user 12 asks the rule editor for lists to pick
      Then user 12 gets the list "Groceries" to pick, with nothing else that Acme keeps on it

    Scenario: Other kinds, other sources and other instances are not found
      Given Acme Tasks also runs as the instance "shopping"
      And the role "family" lets its users write their own rules on "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      When user 12 asks the rule editor for saved views, for a source of options and for the lists of "shopping"
      Then user 12 is told each time that there is no such thing

    Scenario: Without the switch, the rule editor is refused
      Given the admin sets the maximum of "family" for the group "tasks" to ask
      And the role "family" lets its users write their own rules on "tasks"
      And the admin turns off own rules for "family" on "tasks"
      When user 12 asks the rule editor for lists to pick
      Then user 12 is told that their role does not allow it

  Rule: An admin rule is live while a role can reach it at ask

    Scenario: A rule at level write with a role at write is inert
      Given the group "tasks" of "tasks" is at level write
      And the admin pre-approves adding any task to "Groceries"
      When the admin sets the maximum of "family" for the group "tasks" to write
      Then the admin sees that the rule is inert, because the level is write

    Scenario: A role maximum ask makes the rule live
      Given the group "tasks" of "tasks" is at level write
      And the admin pre-approves adding any task to "Groceries"
      When the admin sets the maximum of "family" for the group "tasks" to ask
      Then the admin sees that the rule is live

    Scenario: A role at write that allows own levels makes the rule live
      Given the group "tasks" of "tasks" is at level write
      And the admin pre-approves adding any task to "Groceries"
      And the admin sets the maximum of "family" for the group "tasks" to write
      When the role "family" lets its users set their own levels on "tasks"
      Then the admin sees that the rule is live
