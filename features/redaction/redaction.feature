@id:redaction
Feature: Redaction
  Core hides secrets before a value reaches the agent, an approver or the audit log.
  It hides values under sensitive key names, the parameters and results that a plugin declares secret, and the secret values of the instance.
  A plugin only names what is secret. Core does the hiding.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: Sensitive keys are hidden at any depth

    Scenario: Keys with a sensitive name are hidden, whatever their case, separator or depth
      Given Acme keeps "API_KEY", "private-key" and "db_password" on the task "milk", each one deeper than the last
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "API_KEY", "private-key" and "db_password" of "milk" as [REDACTED]

    Scenario: A sensitive word inside another word does not hide the key
      Given Acme keeps "bypass", "passive", "compass" and "smtp_pass" on the task "milk"
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "bypass", "passive" and "compass" of "milk" as Acme keeps them, but "smtp_pass" as [REDACTED]

    Scenario: Flags, counts and an empty password stay visible
      Given Acme keeps "password_set" as true, "max_tokens" as 4096 and "password" as empty on the task "milk"
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "password_set", "max_tokens" and "password" of "milk" as Acme keeps them

  Rule: The plugin and the admin can add sensitive keys

    Scenario: A key that the plugin lists is hidden
      Given the plugin of "tasks" lists "doorCode" as a sensitive key
      And Acme keeps "doorCode" on the task "milk"
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "doorCode" of "milk" as [REDACTED]

    Scenario: A key that the admin lists for the instance is hidden
      Given Acme keeps "loyaltyNumber" on the task "milk"
      And agent 7 has an open session on "tasks"
      When the admin lists "loyaltyNumber" as a sensitive key of "tasks"
      And agent 7 reads the open tasks of "Groceries" in full in the same session
      Then agent 7 sees "loyaltyNumber" of "milk" as [REDACTED]

    Scenario: A plugin that lists "code" as sensitive does not hide the refusal code
      Given the plugin of "tasks" lists "code" as a sensitive key
      And the admin sets the group "tasks" of "tasks" to none
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the admin turned the operation off

  Rule: Declared secret parameters are hidden but sent

    Scenario: The approver and the audit log never see the PIN of an add
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries" with the PIN "4711"
      When the admin opens the approval page
      Then the approval page shows the PIN as [REDACTED]
      And the audit log shows the PIN of the add of "butter" as [REDACTED]

    Scenario: Acme gets the real PIN
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries" with the PIN "4711"
      When the admin approves the call and agent 7 resumes it
      Then Acme receives the add of "butter" with the PIN "4711"

    Scenario Outline: The PIN is hidden when the agent writes its name as "<name>"
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries" with "<name>" set to "4711"
      When the admin opens the approval page
      Then the approval page shows "<name>" as [REDACTED]
      And the audit log shows "<name>" of the add of "butter" as [REDACTED]

      Examples:
        | name |
        | PIN  |
        | Pin  |

    Scenario: The approver never sees the lock code of a rename, whatever its case
      Given Acme also has the list "Chores" with the open task "dishes"
      When agent 7 renames "Chores" to "Housework" with "LockCode" set to "2468"
      Then the approval page shows "LockCode" as [REDACTED] after
      And the approval page never shows "2468"

  Rule: Declared secret results are hidden

    Scenario: A declared field is hidden on each task, though its name is plain
      Given the plugin of "tasks" declares the field "key" of the open tasks secret
      And Acme keeps "key" on the task "milk"
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "key" of "milk" as [REDACTED]

    Scenario: A whole result declared secret is hidden
      Given the plugin of "tasks" declares the whole result of the open tasks secret
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 gets [REDACTED] in place of the tasks

    Scenario: A declared field one level down stays visible
      Given the plugin of "tasks" declares the field "key" of the open tasks secret
      And Acme keeps "key" on the task "milk" one level down
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "key" of "milk" one level down as Acme keeps it

  Rule: A result field declared secret at any depth is hidden at every level

    Scenario: A declared field deep down is hidden
      Given the plugin of "tasks" declares the field "key" of the open tasks secret at any depth
      And Acme keeps "key" on the task "milk" three levels down
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees "key" of "milk" as [REDACTED]

    Scenario: Everything deeper than 16 levels is hidden
      Given the plugin of "tasks" declares the field "key" of the open tasks secret at any depth
      And Acme keeps the note "aisle 4" on the task "milk" twenty levels down
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees [REDACTED] in place of the note "aisle 4"

  Rule: A secret value is hidden wherever it appears

    Scenario: The API token in a title and in a field name is hidden
      Given Acme has a task in "Groceries" whose title quotes the API token
      And Acme keeps a field named after the API token on the task "milk"
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees [REDACTED] in place of the API token, in the title and in the field name

    Scenario: A secret value in encoded form is hidden
      Given the instance "tasks" has the webhook secret "p@ss word!"
      And Acme has a task in "Groceries" whose title holds the webhook secret in encoded form
      When agent 7 reads the open tasks of "Groceries" in full
      Then agent 7 sees [REDACTED] in place of the webhook secret

    Scenario: A secret value of three characters stays visible
      Given the instance "tasks" has the webhook secret "abc"
      And Acme has the task "abc stays" in "Groceries"
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread", "eggs" and "abc stays"

  Rule: Code cannot uncover a secret value

    Scenario: The code builds the API token and returns it
      When the code of agent 7 builds the API token from its characters and returns it
      Then agent 7 gets [REDACTED]

    Scenario: The code builds the API token and logs it
      When the code of agent 7 builds the API token from its characters and logs it
      Then agent 7 sees the log line "the token is [REDACTED]"

    Scenario: The code builds the API token and throws it
      When the code of agent 7 builds the API token from its characters and throws it in an error
      Then agent 7 is told that its code failed with "bad token [REDACTED]"

  Rule: A list of changes hides its secret paths

    Scenario Outline: The share password is hidden however the plugin names its path
      Given the plugin of "tasks" names the share password in its changes by <form>
      And the list "Groceries" has the share password "groceries-share-7"
      When agent 7 renames "Groceries" to "Food" with the share password "groceries-share-8"
      Then the approval page shows the share password as [REDACTED] before and after
      And the approval page shows neither "groceries-share-7" nor "groceries-share-8"

      Examples:
        | form           |
        | "a pointer"    |
        | "a dot path"   |
        | "a bare name"  |

    Scenario: A change to a declared secret parameter is hidden
      When agent 7 renames "Groceries" to "Food" with the lock code "2468"
      Then the approval page shows the lock code as [REDACTED]
      And the approval page never shows "2468"

    Scenario: A change of the whole list hides the lock code inside it
      Given Acme Tasks reports a rename as one change of the whole list
      When agent 7 renames "Groceries" to "Food" with the lock code "2468"
      Then the approval page shows the new name "Food", and the lock code as [REDACTED]
      And the approval page never shows "2468"

  Rule: Odd values never break redaction

    Scenario: A parameter named "__proto__" is shown as a plain parameter
      When the code of agent 7 adds "butter" to "Groceries" with a parameter named "__proto__"
      Then the approval page shows the parameter "__proto__" with its value
