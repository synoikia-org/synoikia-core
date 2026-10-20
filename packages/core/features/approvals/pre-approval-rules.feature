@id:pre-approval-rules
Feature: Pre-approval rules
  An admin can write rules that approve some calls without a human.
  A rule applies only to an operation at level ask, and only when it names every parameter of the call.
  A user can write own rules that approve the calls of their own agents.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "dishes"
    And agent 7 belongs to the admin and may read and write
    And the group "tasks" of "tasks" is at level ask

  Rule: A matching rule approves without a human, at ask only

    Scenario: A rule approves an add to Groceries
      Given the admin pre-approves adding any task to "Groceries"
      When agent 7 adds "butter" to "Groceries"
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"
      And the audit log shows that the rule approved the add of "butter"

    Scenario: An add to a list the rule does not name waits for a human
      Given the admin pre-approves adding any task to "Groceries"
      When agent 7 adds "soap" to "Chores"
      Then agent 7 is told that the call waits for a human to approve it

    Scenario: A rule covers a read at its own level ask
      Given the admin gives "show the open tasks" its own level ask
      And the admin pre-approves showing the open tasks of "Groceries"
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs"

  Rule: A rule matches strictly
    A rule covers a call only when it names every parameter of the call.
    A rule can accept any value of a parameter, or any parameter at all.

    Scenario: A due date the rule does not name sends the add to a human
      Given the admin pre-approves adding any task to "Groceries"
      When agent 7 adds "butter" to "Groceries" due on "2026-10-20"
      Then agent 7 is told that the call waits for a human to approve it
      And the admin sees that the rule missed a call because of a parameter it does not name

    Scenario: A rule that accepts any due date covers adds with and without one
      Given the admin pre-approves adding any task to "Groceries" with any due date
      When agent 7 adds "butter" due on "2026-10-20" and "jam" with no due date to "Groceries"
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs", "butter" and "jam"

    Scenario Outline: An empty rule covers only a count of every list
      Given the admin gives "count the tasks" its own level ask
      And the admin pre-approves "count the tasks" with <rule>
      When agent 7 counts the open tasks of <lists>
      Then agent 7 <answer>

      Examples:
        | rule          | lists       | answer                                                |
        | an empty rule | every list  | is told that 4 tasks are open                         |
        | an empty rule | "Groceries" | is told that the call waits for a human to approve it |
        | any parameter | "Groceries" | is told that "Groceries" has 3 open tasks             |

  Rule: Each match field compares in its own way
    A list prefix matches the list itself and the lists below it.
    Tags match when each tag is in the rule. A priority must be a number in the range. A star must be a real yes or no.

    Scenario Outline: A list prefix matches the list and the lists below it
      Given Acme also has the lists "Groceries/Weekly" and "Groceries-Old"
      And the admin pre-approves adding any task to "Groceries"
      When agent 7 adds "butter" to <list>
      Then agent 7 <answer>

      Examples:
        | list               | answer                                                |
        | "Groceries"        | gets the new task "butter" without a question         |
        | "Groceries/Weekly" | gets the new task "butter" without a question         |
        | "Groceries-Old"    | is told that the call waits for a human to approve it |

    Scenario Outline: Every condition must hold, each in its own way
      Given the admin pre-approves adding tasks to "Groceries" with the tags "home" or "errands", a priority from 1 to 3 and a star
      When agent 7 adds "butter" to "Groceries" with the tags <tags>, the priority <priority> and the star <star>
      Then agent 7 <answer>

      Examples:
        | tags            | priority | star           | answer                                                |
        | "home, errands" | "2"      | "yes"          | gets the new task "butter" without a question         |
        | "home, work"    | "2"      | "yes"          | is told that the call waits for a human to approve it |
        | "home"          | "5"      | "yes"          | is told that the call waits for a human to approve it |
        | "home"          | "two"    | "yes"          | is told that the call waits for a human to approve it |
        | "home"          | "none"   | "yes"          | is told that the call waits for a human to approve it |
        | "home"          | "2"      | "the word yes" | is told that the call waits for a human to approve it |

  Rule: A target condition holds for every target
    The tasks of a list are in the scope of that list. The tasks in the "Inbox" belong to no list.

    Scenario Outline: A rule on the list of the tasks covers a complete only when every task is in that list
      Given Acme also has the list "Pantry" with the open task "milk"
      And Acme also has the list "Inbox" with the open task "milk"
      And the admin pre-approves completing tasks in the list "Groceries"
      When agent 7 completes <task> in <lists>
      Then agent 7 <answer>

      Examples:
        | task   | lists                     | answer                                                |
        | "milk" | "Groceries"               | gets the task done without a question                 |
        | "milk" | "Groceries" and "Pantry"  | is told that the call waits for a human to approve it |
        | "milk" | "Groceries" and "Inbox"   | is told that the call waits for a human to approve it |
        | "salt" | "Groceries"               | is told that the call waits for a human to approve it |

    Scenario Outline: A target condition that selects nothing or an unknown scope is refused
      When the admin tries to pre-approve completing tasks <selection>
      Then the admin is told <message>

      Examples:
        | selection                    | message                                                       |
        | with no list and no task     | to select at least one task or list                           |
        | in the folder "Home"         | that "complete a task" cannot select tasks by "folder"         |

  Rule: A rule has its own limits and life

    Scenario: A rule at one add an hour sends the second add to a human
      Given the admin pre-approves adding any task to "Groceries" once an hour
      And agent 7 added "butter" to "Groceries"
      When agent 7 adds "jam" to "Groceries"
      Then agent 7 is told that the call waits for a human to approve it
      And the audit log shows that the add of "jam" passed the rule because it reached its limit

    Scenario Outline: An expired or disabled rule is ignored
      Given the admin pre-approves adding any task to "Groceries", but the rule <state>
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the call waits for a human to approve it

      Examples:
        | state             |
        | expired yesterday |
        | is turned off     |

    Scenario: The admin cannot write a rule for a locked operation
      Given the admin gives "delete a list" its own level ask
      When the admin tries to pre-approve deleting the list "Chores"
      Then the admin is told that "delete a list" is locked and can never be pre-approved

    Scenario: A rule for a locked operation that reached the database another way never applies
      Given the admin gives "delete a list" its own level ask
      And the database holds a rule that approves deleting the list "Chores"
      When agent 7 deletes the list "Chores"
      Then agent 7 is told that the call waits for a human to approve it

  Rule: A rule that cannot apply is marked inert

    Scenario Outline: A rule on an operation that never asks is inert
      Given the admin pre-approves adding any task to "Groceries"
      When the admin sets the group "tasks" to <level>
      Then the admin sees that the rule is inert, because the level is <level>

      Examples:
        | level |
        | write |
        | none  |

    Scenario: A role that keeps the add at ask keeps the admin rule live
      Given user 12 has the role "family", which has the instance "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      And the admin pre-approves adding any task to "Groceries"
      When the admin sets the group "tasks" to write
      Then the admin sees that the rule is live

  Rule: An own rule approves only its owner's calls

    Background:
      Given user 12 has the role "family", which has the instance "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      And the role "family" lets its users write their own rules on "tasks"
      And agent 9 belongs to user 12 and may read and write

    Scenario: An own rule approves an add by an agent of its owner
      Given user 12 pre-approves adding any task to "Groceries"
      When agent 9 adds "butter" to "Groceries"
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"

    Scenario: An own rule does not cover the agent of another user
      Given user 12 pre-approves adding any task to "Groceries"
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the call waits for a human to approve it

    Scenario Outline: When the role turns own rules off, only admin rules still apply
      Given <who> pre-approves adding any task to "Groceries"
      And the admin turns off own rules for "family" on "tasks"
      When agent 9 adds "butter" to "Groceries"
      Then agent 9 <answer>

      Examples:
        | who       | answer                                                |
        | user 12   | is told that the call waits for a human to approve it |
        | the admin | gets the new task "butter" without a question         |
