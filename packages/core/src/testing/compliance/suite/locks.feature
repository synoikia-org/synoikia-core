@id:compliance-locks
Feature: Locked operations
  A locked operation can delete or move data that core cannot restore. Core runs it only after a human types its confirmation.
  The plugin locks the operation, names its target in the approval and gives core the literal to type.

  Rule: A locked operation runs only with its typed confirmation

    Scenario: Each locked operation is off at the level of its group
      Given the groups of the locked operations are at level write
      When the agent makes the call of each lock case
      Then core refuses each call, because the operation is off

    Scenario: Each locked operation asks to type the literal of its case
      Given each locked operation is at level ask
      When the agent makes the call of each lock case, and the human types a wrong literal and then the right one
      Then core refused the wrong literal and ran the call with the literal of its case

    Scenario: The approval of each locked operation names its target
      Given each locked operation is at level ask
      When the agent makes the call of each lock case, and the human reads the approval
      Then the approval shows the target of each lock case
