@id:openapi-catalog
Feature: OpenAPI catalog
  Plugin author 3 builds the catalog of the "Acme Tasks" plugin from the OpenAPI 3 description that Acme Tasks serves.
  The rules of plugin.yaml apply to every operation of the description.
  The plugin turns each generic request of the agent into one operation of that catalog, or refuses the request.

  Background:
    Given plugin author 3 has a plugin folder for "Acme Tasks" with a minimal manifest
    And Acme Tasks describes its API in an OpenAPI 3.0 description

  Rule: Only a plausible OpenAPI 3 description is read

    Scenario Outline: A description that is not OpenAPI 3 is refused as an upstream error that names Acme Tasks
      Given Acme Tasks gives <description>
      When plugin author 3 builds the catalog from the description
      Then the catalog is refused with the upstream error "<reason>"

      Examples:
        | description                              | reason                                                                                 |
        | an OpenAPI 2 description                 | The Acme Tasks API spec is not OpenAPI 3   |
        | a description that is not YAML           | The Acme Tasks API spec is not valid YAML  |
        | an empty description                     | The Acme Tasks API spec is empty           |
        | an OpenAPI 3.0 description with no paths | The Acme Tasks API spec has no paths       |

    Scenario: An OpenAPI 3.1 description is read
      Given Acme Tasks gives its description as OpenAPI 3.1
      When plugin author 3 builds the catalog from the description
      Then the catalog holds "Show the open tasks" and "Add a task"

    Scenario: A description that expands a chain of YAML aliases is refused
      Given Acme Tasks gives a description with 12 levels of YAML aliases, each 9 times the level before
      When plugin author 3 builds the catalog from the description
      Then the catalog is refused with "The Acme Tasks API spec is not valid YAML"

  Rule: A read is a read only when it looks like a read

    Scenario Outline: An operation is a read only when its method, its name and its path look like a read
      When plugin author 3 builds the catalog from the description
      Then the operation "<operation>" at "<path>" is <kind>

      Examples:
        | operation             | path                    | kind                         |
        | Show the open tasks   | /lists/{listId}/tasks   | a read that needs no review  |
        | Add a task            | /lists/{listId}/tasks   | a write that needs no review |
        | Delete a list         | /lists/{listId}         | a write that needs no review |
        | Reset the list        | /lists/{listId}/state   | a write that needs a review  |
        | A clean list          | /lists/{listId}/reset   | a write that needs a review  |
        | Due tasks of the list | /lists/{listId}/run-now | a write that needs a review  |

    Scenario: Plugin author 3 turns off the guess from names and paths
      Given the plugin turns off the guess from the names and the paths of reads
      When plugin author 3 builds the catalog from the description
      Then the operation "Reset the list" at "/lists/{listId}/state" is a read that needs no review

  Rule: The catalog is built with the rules applied

    Scenario: Excluded and unsafe paths are left out
      Given plugin.yaml excludes every path under "/internal"
      When plugin author 3 builds the catalog from the description
      Then the catalog holds 15 operations, and none at "/internal/debug", "/../escape" or "/bad path"

    Scenario: An operation keeps its group, its documentation and its parameters
      When plugin author 3 builds the catalog from the description
      Then "Show the open tasks" is in the group "tasks" with the description "The tasks of the list that are not done."
      And "Show the open tasks" takes the required "listId" in its path and "limit" in its query

    Scenario: A locked delete gets a locked twin for the lists of another user
      Given plugin.yaml locks "Delete a list" and splits it for "other-user"
      When plugin author 3 builds the catalog from the description
      Then "Delete a list" and its twin for "other-user" are locked writes with a typed confirmation

  Rule: A description that could hide an operation is refused

    Scenario Outline: Lookalike paths, too many schema nodes or too few operations are refused
      Given <situation>
      When plugin author 3 builds the catalog from the description
      Then the catalog is refused with "<reason>"

      Examples:
        | situation                                                                | reason                                       |
        | Acme Tasks also describes "Delete a list" at "/lists/{id}/"              | The Acme Tasks API spec has two operations for |
        | the schema of a task in Acme Tasks fans out 40 ways on 4 levels          | The Acme Tasks API spec expands to too many schema nodes |
        | the plugin expects at least 50 operations from Acme Tasks                | The Acme Tasks API spec has only 16 operations |

    Scenario: A schema that refers to itself stays a reference
      When plugin author 3 builds the catalog from the description
      Then the parent of a list in "Rename a list" reads "See #/components/schemas/List"

  Rule: Paths match only in plain form

    Scenario Outline: A plain path finds its operation
      Given plugin author 3 built the catalog from the description
      When the plugin matches a <method> of the path "<path>"
      Then the path finds "<operation>" with "<value>" as its "<parameter>"

      Examples:
        | method | path                  | operation           | parameter | value     |
        | read   | /lists/l-1/tasks/     | Show the open tasks | listId    | l-1       |
        | read   | /lists/__proto__      | Show a list         | listId    | __proto__ |
        | change | /lists/l-1/tasks/milk | Complete a task     | title     | milk      |

    Scenario Outline: A path that is not plain finds nothing
      Given plugin author 3 built the catalog from the description
      When the plugin matches a read of the path "<path>"
      Then the path finds no operation

      Examples:
        | path                    |
        | /lists/l-1/../l-2/tasks |
        | /lists/./l-1            |
        | /lists//tasks           |
        | /lists/a%2Fb/tasks      |
        | /lists/%E0%A4%A/tasks   |
        | /nope                   |

  Rule: Path values are encoded, and unsafe values are refused

    Scenario Outline: A list id is encoded into the path
      When the plugin fills the path of "Show the open tasks" with the list <value>
      Then the plugin gets the path "<path>"

      Examples:
        | value   | path                   |
        | "a b/c" | /lists/a%20b%2Fc/tasks |
        | "..."   | /lists/.../tasks       |
        | 42      | /lists/42/tasks        |

    Scenario Outline: A dot, an object or a missing list id is refused
      When the plugin fills the path of "Show the open tasks" with the list <value>
      Then the path is refused with "<reason>"

      Examples:
        | value     | reason                                |
        | ".."      | cannot be ..                          |
        | "."       | cannot be .                           |
        | {id: l-1} | must be a string or number            |
        | no value  | Missing path parameter listId         |

  Rule: A generic request resolves only to catalog operations

    Scenario Outline: A malformed or unknown request is refused with a clear reason
      When the agent sends Acme Tasks the request <request>
      Then the request is refused with "<reason>"

      Examples:
        | request                       | reason                                                    |
        | "/lists"                      | acme.request({ method, path, query, body }) takes one object |
        | {method: TRACE, path: /lists} | method TRACE                                              |
        | {path: lists}                 | path must be a string starting with /                     |
        | {path: "/lists?limit=1"}      | Pass query parameters in `query`, not in the path         |
        | {path: /lists, query: limit}  | query must be an object                                   |
        | {path: /nope}                 | GET /nope is not an operation of the Acme Tasks API       |

    Scenario: Core cannot run an operation that is not in the catalog
      When core runs the read of "/nope" on Acme Tasks
      Then the request is refused with "/nope is not an operation of the Acme Tasks API"

    Scenario Outline: A request resolves to its operation, and a list of another user to the locked twin
      Given plugin.yaml splits "Delete a list" for "other-user"
      And Acme Tasks has the list "Groceries" as "l-1" and the list "Chores" of another user as "l-2"
      When the agent sends Acme Tasks the request <request>
      Then the request resolves to "<operation>" with <params>

      Examples:
        | request                                                      | operation                   | params                                        |
        | {method: post, path: /lists/l-1/tasks, body: {title: butter}} | Add a task                  | {path: {listId: l-1}, body: {title: butter}}  |
        | {path: /lists/l-1/tasks, query: {limit: 2}, body: {title: x}} | Show the open tasks         | {path: {listId: l-1}, query: {limit: 2}}      |
        | {method: delete, path: /lists/l-1}                            | Delete a list               | {path: {listId: l-1}}                         |
        | {method: delete, path: /lists/l-2}                            | Delete a list for other-user | {path: {listId: l-2}}                        |

    Scenario: The approver sees the method, the path, the body cut short and the note of the twin
      Given plugin.yaml splits "Rename a list" for "other-user" with the note "(another user's list)"
      And Acme Tasks has the list "Groceries" as "l-1" and the list "Chores" of another user as "l-2"
      And the locked operations take the list id as their literal
      When core asks for the summary of the rename of the list "l-2" to 500 copies of "y"
      Then the summary shows the change of "/lists/l-2", the name cut after 400 characters and "(another user's list)", and the approver types "l-2"

  Rule: A path value never reaches an unapproved path

    Scenario Outline: A lookup reads only, and only with a plain list id
      When the plugin looks up the list "<list>" with "<operation>"
      Then the lookup is refused
      And Acme Tasks gets no request

      Examples:
        | list | operation     |
        | ..   | Show a list   |
        | .    | Show a list   |
        | l-1  | Delete a list |

    Scenario: A lookup with a plain list id reads the list
      Given Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      When the plugin looks up the list "l-1" with "Show a list"
      Then the lookup gives the list "Groceries"

  Rule: Bodies use the encoding that the description asks for

    Scenario Outline: A body goes out in the encoding of its operation
      Given Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      When the agent sends "<operation>" on "Groceries" with the fields <fields>
      Then Acme Tasks receives the body as <encoding> "<body>"

      Examples:
        | operation    | fields              | encoding             | body               |
        | Share a list | {password: hunter2} | form fields          | password=hunter2   |
        | Import tasks | {file: milk}        | multipart fields     | file=milk          |
        | Add a task   | {title: butter}     | the default encoding | {"title":"butter"} |

    Scenario: A text body for a form is refused, and nothing is sent
      Given Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      When the agent sends "Share a list" on "Groceries" with the fields "password=hunter2"
      Then the request is refused with "body must be an object of form fields"
      And Acme Tasks gets no request

  Rule: The description comes from the first version that exists

    Scenario: A missing version moves on to the next, and no token is sent
      Given Acme Tasks serves its description only for "main"
      When the plugin fetches the description for "v4.2", then for "main"
      Then the plugin gets the description for "main", and Acme Tasks receives no token with it

    Scenario Outline: A failure stops the search, and no description gives a clear error
      Given <situation>
      When the plugin fetches the description for "v4.2", then for "main"
      Then the fetch is refused with "<reason>"

      Examples:
        | situation                                                         | reason                                         |
        | Acme Tasks fails to serve the description for "v4.2"              | Fetching the Acme Tasks API spec failed         |
        | Acme Tasks serves no description                                  | No Acme Tasks API spec found for v4.2 or main  |
        | the plugin takes a description of at most 1024 bytes, and Acme Tasks serves more | The Acme Tasks API spec is too large |
        | Acme Tasks is down                                                | Could not fetch the Acme Tasks API spec from 127.0.0.1: |
