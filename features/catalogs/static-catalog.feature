@id:static-catalog
Feature: Static catalog
  Plugin author 3 declares the operations of "Acme Tasks" in plugin.yaml when the plugin has nothing to discover.
  The rules apply to declared operations as they apply to discovered ones.
  The plugin checks each call to a declared operation before the call reaches Acme Tasks.

  Background:
    Given plugin author 3 has a plugin folder for "Acme Tasks" with a minimal manifest
    And plugin.yaml declares these operations of Acme Tasks:
      | operation    | kind       | class | request                       | body      | reason      | attestation |
      | lists.show   | command    | read  | read /lists/{listId}/tasks    |           |             | no          |
      | lists.delete | command    | write | removal /lists/{listId}       |           |             | no          |
      | lists.share  | command    | write | add /lists/{listId}/share     | form      |             | no          |
      | tasks.import | command    | write | add /lists/{listId}/import    | multipart |             | no          |
      | tasks.sync   | ws_command | write |                               |           | shape:write | yes         |
    And plugin.yaml locks "lists.delete" and confirms it with the list id
    And Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"

  Rule: Declared operations get the same rules as discovered ones

    Scenario: The catalog describes each declared operation with its rules
      When plugin author 3 builds the declared catalog
      Then the declared catalog holds:
        | operation    | kind       | class | reason             | locked | attestation |
        | lists.show   | command    | read  | declared:read      | no     | no          |
        | lists.delete | command    | write | locked:destructive | yes    | no          |
        | lists.share  | command    | write | declared:write     | no     | no          |
        | tasks.import | command    | write | declared:write     | no     | no          |
        | tasks.sync   | ws_command | write | shape:write        | no     | yes         |

    Scenario: The approver of a declared delete sees the path and types the list id
      When core asks for the summary of "lists.delete" on the list "l-1"
      Then the summary reads "Acme Tasks lists.delete:" with the removal of "/lists/l-1", and the approver types "l-1"

  Rule: Calls to declared operations are checked before they reach Acme Tasks

    Scenario Outline: A call that is not a declared web call, or has bad parameters, is refused
      When the agent calls "<operation>" with <params>
      Then the call is refused as <kind> with "<reason>"
      And Acme Tasks gets no request

      Examples:
        | operation          | params                      | kind                 | reason                                   |
        | tasks.sync         | {}                          | an unknown operation | tasks.sync is not a Acme Tasks operation |
        | lists.archive      | {}                          | an unknown operation | lists.archive is not a Acme Tasks operation |
        | lists.delete#other | {path: {listId: l-1}}       | invalid parameters   | operation must be a name                 |
        | lists.show         | "l-1"                       | invalid parameters   | params must be an object                 |
        | lists.delete       | {path: {listId: {id: l-1}}} | invalid parameters   | path.listId must be a string or number   |
        | lists.delete       | {path: {listId: ".."}}      | invalid parameters   | cannot be ..                             |

    Scenario: A call with almost no time left still waits one second for Acme Tasks
      Given Acme Tasks answers after 500 milliseconds
      When the agent calls "lists.show" on "Groceries" with 10 milliseconds left
      Then the plugin gets "milk", "bread" and "eggs"

  Rule: A declared body goes out in its declared encoding

    Scenario Outline: A declared form or multipart body is encoded as declared
      When the agent calls "<operation>" on "Groceries" with the fields <fields>
      Then Acme Tasks receives the body as <encoding> "<body>"

      Examples:
        | operation    | fields              | encoding         | body             |
        | lists.share  | {password: hunter2} | form fields      | password=hunter2 |
        | tasks.import | {file: milk}        | multipart fields | file=milk        |

    Scenario: A list of values for a form is refused, and nothing is sent
      When the agent calls "lists.share" on "Groceries" with the fields [hunter2]
      Then the call is refused as invalid parameters with "body must be an object of form fields"
      And Acme Tasks gets no request

    Scenario: An unknown body encoding is refused when plugin.yaml loads
      Given plugin.yaml also declares "lists.export" with the body encoding "xml"
      When plugin author 3 loads plugin.yaml
      Then plugin.yaml is refused
