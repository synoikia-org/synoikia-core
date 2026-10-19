@id:operation-rules
Feature: Operation rules
  Plugin author 3 writes plugin.yaml on top of the operations that the "Acme Tasks" plugin finds.
  The rules exclude, lock, classify and protect operations before core sees the catalog.
  The classification fails closed: an operation that no one can classify is a write.

  Background:
    Given plugin author 3 has a plugin folder for "Acme Tasks" with a minimal manifest

  Rule: The rules file is strict

    Scenario: An empty rules file gives the default time limits
      Given plugin.yaml is empty
      When plugin author 3 loads plugin.yaml
      Then a request has 15 seconds and a lookup has 10 seconds

    Scenario Outline: A misspelled key, a bad pointer, a bad twin suffix or an unknown class is refused
      Given plugin.yaml holds "<line>"
      When plugin author 3 loads plugin.yaml
      Then plugin.yaml is refused

      Examples:
        | line                                                         |
        | rule: []                                                     |
        | rules: [{match: lists.delete, lockd: true}]                  |
        | rules: [{match: tasks.import, sensitiveParams: [0/token]}]   |
        | rules: [{match: lists.delete, split: Other User}]            |
        | rules: [{match: lists.show, classification: admin}]          |

    Scenario: The plugin's own section is checked by the plugin's own schema
      Given the plugin takes a page size from 1 to 100 in its own section
      And plugin.yaml holds "plugin: {pageSize: 500}"
      When plugin author 3 loads plugin.yaml
      Then plugin.yaml is refused at "pageSize"

  Rule: An excluded operation exists only when it is included again

    Scenario: Sign-in and core operations are left out, except the ping
      Given the plugin finds the reads "auth.login", "core.debug", "core.ping" and "lists.show"
      And plugin.yaml excludes "auth.*" and "core.*" and includes "core.ping"
      When plugin author 3 builds the catalog
      Then the catalog holds only "core.ping" and "lists.show"

  Rule: The classification fails closed

    Scenario: A locked operation is a write with a typed confirmation, even when a rule says read
      Given the plugin finds "lists.delete" in the group "lists" and takes it for a read
      And plugin.yaml locks "lists.delete" and also classifies it as a read
      When plugin author 3 builds the catalog
      Then "lists.delete" is a locked write with a typed confirmation and the reason "locked:destructive"

    Scenario: An operation no one can classify is a write, and the plugin's read stays a read
      Given the plugin finds "tasks.sync" in the group "tasks" and cannot classify it
      And the plugin finds "lists.show" in the group "lists" and takes it for a read
      When plugin author 3 builds the catalog
      Then "tasks.sync" is a write with the reason "default:ambiguous"
      And "lists.show" is a read with the reason "plugin:read"

    Scenario: A reviewed read wins over the plugin's guess and clears the review
      Given the plugin finds "lists.count" in the group "lists", takes it for a write and asks for a review
      And plugin.yaml classifies "lists.count" as a read with the reason "reviewed:read" and no review
      When plugin author 3 builds the catalog
      Then "lists.count" is a read with the reason "reviewed:read" that needs no review

  Rule: A split twin is locked and inherits the protection of its base

    Scenario: Deleting a list of another user is a locked twin with the same protection
      Given the plugin finds "lists.delete" in the group "lists" with the summary "Delete a list"
      And plugin.yaml splits "lists.delete" for "other-user" with a secret "/password" and the guidance "Name the list by its id."
      And plugin.yaml describes every "#other-user" twin as "{base} for another user" with the note "for another user"
      When plugin author 3 builds the catalog
      Then "lists.delete#other-user" is locked with the secret "/password", the guidance, the description "lists.delete for another user" and the note "for another user"

    Scenario: Any key with a twin suffix is locked
      Given the plugin finds "tasks.add#bulk" in the group "tasks" and takes it for a write
      And plugin.yaml is empty
      When plugin author 3 builds the catalog
      Then "tasks.add#bulk" is a locked write with a typed confirmation and the reason "locked:destructive"

  Rule: Rules add match profiles, attestation and secret parameters

    Scenario: A rule sets the match profile, requires attestation and adds a secret parameter
      Given the plugin finds "tasks.import" in the group "tasks" with the secret parameter "/token"
      And plugin.yaml gives "tasks.import" the match profile "list-name", attestation and the secret parameter "/password"
      When plugin author 3 builds the catalog
      Then "tasks.import" has the match profile "list-name", requires attestation and keeps "/token" and "/password" secret

    Scenario: More than 32 secret parameters are refused
      Given the plugin finds "tasks.import" in the group "tasks" and takes it for a write
      And two rules of plugin.yaml give "tasks.import" 20 secret parameters each
      When plugin author 3 builds the catalog
      Then the catalog is refused with "tasks.import has 40 sensitiveParams" and "the limit is 32"

  Rule: Only a locked operation gets a confirmation literal

    Scenario: An unlocked operation gets no literal
      Given plugin.yaml confirms "lists.rename" with the list name that Acme Tasks gives for the parameter "/list"
      When core asks for the literal of "lists.rename" on the list "l-1"
      Then the approver types nothing

    Scenario Outline: A locked delete types the list name, or the id when Acme Tasks has no name
      Given Acme Tasks has the lists "Groceries" as "l-1" and a list with no name as "l-2"
      And plugin.yaml locks "lists.delete" and confirms it with the list name that Acme Tasks gives for the parameter "/list"
      When core asks for the literal of "lists.delete" on the list "<list>"
      Then the approver types "<literal>"

      Examples:
        | list | literal   |
        | l-1  | Groceries |
        | l-2  | l-2       |
        | l-9  | l-9       |

  Rule: A literal comes from a fixed order of sources

    Scenario Outline: A locked operation with no source of its own types the instance name
      Given Acme Tasks names its account "<account>"
      And plugin.yaml confirms locked operations with the account name, or "Acme Tasks ({key})" when it has none
      And plugin.yaml locks "lists.archive"
      When core asks for the literal of "lists.archive" on the list "l-1"
      Then the approver types "<literal>"

      Examples:
        | account   | literal                    |
        | Acme home |  Acme home                 |
        |           |  Acme Tasks (lists.archive) |

    Scenario Outline: Target names come first, and the parameter after them
      Given plugin.yaml locks "lists.delete" and confirms it with the target names, then the parameter "/list"
      When core asks for the literal of "lists.delete" on the list "l-1" with <targets>
      Then the approver types "<literal>"

      Examples:
        | targets                                      | literal       |
        | the targets "Groceries" and an unnamed "l-2" | Groceries, l-2 |
        | no targets                                   | l-1           |

    Scenario: A custom source of the plugin gives the literal
      Given the plugin gives the owner "author3" as its custom source "owner"
      And plugin.yaml locks "lists.delete" and confirms it with the custom source "owner"
      When core asks for the literal of "lists.delete" on the list "l-1"
      Then the approver types "author3"

  Rule: A lookup takes only a plain id

    Scenario: A list given as an object is never looked up
      Given plugin.yaml locks "lists.delete" and confirms it with the list name that Acme Tasks gives for the parameter "/list"
      When core asks for the literal of "lists.delete" on a list given as an object
      Then the approver types nothing
      And Acme Tasks gets no request

    Scenario Outline: A search matches only the lists that have an id
      Given Acme Tasks has the lists "Groceries" as "l-1", "Chores" as "l-2" and "Inbox" with no id
      And plugin.yaml locks "lists.delete" and confirms it with the name of the list whose id is the parameter "/list"
      When core asks for the literal of "lists.delete" on the list "<list>"
      Then the approver types "<literal>"

      Examples:
        | list      | literal   |
        | l-2       | Chores    |
        | undefined | undefined |

  Rule: Result secrets are declared, and masked when another result embeds them

    Scenario Outline: An embedded result is masked as its own operation declares
      Given plugin.yaml marks the result of "<operation>" as secret by "<rule>"
      When the plugin masks the result <result> of "<operation>" inside another result
      Then the embedded result reads <masked>

      Examples:
        | operation      | rule                              | result                                                     | masked                                                       |
        | tokens.create  | whole                             | "acme-tok-9f8e7d6c"                                        | "[REDACTED]"                                                 |
        | lists.share    | {keys: [password]}                | [{list: Groceries, password: hunter2}, {list: Chores}]     | [{list: Groceries, password: "[REDACTED]"}, {list: Chores}]  |
        | account.export | {keys: [password], deep: true}    | {lists: {groceries: {share: {password: hunter2}}}}          | {lists: {groceries: {share: {password: "[REDACTED]"}}}}      |
        | lists.show     | none                              | {list: Groceries, password: hunter2}                        | {list: Groceries, password: hunter2}                         |

    Scenario: A twin declares the result secret of its base
      Given the plugin finds "tokens.create" in the group "tokens" and takes it for a write
      And plugin.yaml splits "tokens.create" for "admin" and marks its whole result as secret
      When plugin author 3 builds the catalog
      Then "tokens.create" and "tokens.create#admin" both declare their whole result as secret
