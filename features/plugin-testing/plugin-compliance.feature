@id:plugin-compliance @long-running
Feature: Plugin compliance suite
  Core decides if a plugin is fit for production. The compliance suite of the core testing package runs the built plugin in the real core against its fake upstream service.
  The plugin author gives only a compliance profile: the connection, sample calls, a case for each locked operation and the secret values of the fake.
  The suite checks each rule of core and names each rule that the plugin breaks.

  Background:
    Given Acme has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "sweep"
    And the list "Groceries" has the share password "groceries-share-7"
    And the profile of Acme Tasks names "show the open tasks", "add a task", the locks "delete a list" and "archive a list" of "Chores" and the share password

  Rule: A plugin that keeps every rule of core is fit for production

    Scenario: Acme Tasks is fit for production
      When plugin author 3 runs the compliance suite on Acme Tasks
      Then the suite certifies Acme Tasks 1.0.0 for production, with no failed rule

    Scenario Outline: The suite refuses a build that <breaks>
      When plugin author 3 runs the compliance suite on a build of Acme Tasks that <breaks>
      Then the suite does not certify Acme Tasks, because <failure>

      Examples:
        | breaks                                    | failure                                                       |
        | also locks "rename a list"                | "rename a list" is locked and the profile has no case for it  |
        | shows the API token field as plain text   | the API token is a secret that is not write-only              |
        | does not ship the guide of "import tasks" | the guide of "import tasks" is not provided                   |
        | runs only the access rule of the suite    | the suite did not run every rule                              |

  Rule: The catalog of the plugin is valid

    Scenario Outline: The suite refuses a catalog that <breaks>
      When plugin author 3 runs the compliance suite on a build of Acme Tasks that <breaks>
      Then the suite does not certify Acme Tasks, because <failure>

      Examples:
        | breaks                                               | failure                                     |
        | throws "boom" when it loads                          | Acme Tasks does not start, and shows "boom" |
        | syncs no operation                                   | the catalog is empty                        |
        | gives "add a task" no description                    | "add a task" has no description             |
        | locks "purge lists", which its catalog does not have | the lock "purge lists" names no operation   |

  Rule: Access levels decide each call of the plugin

    Scenario Outline: The suite refuses access that <breaks>
      When plugin author 3 runs the compliance suite on a build of Acme Tasks that <breaks>
      Then the suite does not certify Acme Tasks, because <failure>

      Examples:
        | breaks                                        | failure                                               |
        | classifies "add a task" as a read             | "add a task" ran at level read                        |
        | maps an unknown call to "show the open tasks" | Acme Tasks accepted a call that is not in its catalog |

    Scenario: A plugin whose every write is locked needs no sample write
      Given the profile of Acme Tasks names no sample write
      When plugin author 3 runs the compliance suite on a build of Acme Tasks whose only write is "delete a list"
      Then the suite certifies Acme Tasks 1.0.0 for production, with no failed rule

  Rule: A locked operation runs only with its typed confirmation

    Scenario Outline: The suite refuses a lock that <breaks>
      When plugin author 3 runs the compliance suite on a build of Acme Tasks that <breaks>
      Then the suite does not certify Acme Tasks, because <failure>

      Examples:
        | breaks                                                    | failure                                                    |
        | asks to type "delete" to delete a list                    | "delete a list" asks to type "delete" in place of "Chores" |
        | does not lock "delete a list"                             | "delete a list" is not off by default                      |
        | does not name the list in the approval of "delete a list" | the approval of "delete a list" does not show "Chores"     |

  Rule: No secret reaches the agent, the approver or the audit log

    Scenario Outline: The suite refuses a secret that <breaks>
      When plugin author 3 runs the compliance suite on a build of Acme Tasks that <breaks>
      Then the suite does not certify Acme Tasks, because <failure>

      Examples:
        | breaks                                                 | failure                                               |
        | shows the share password under the name "code"         | the share password reached the sandbox                |
        | shows the API token in the approval of "add a task"    | the API token reached the approval                    |
        | passes the connection test with a wrong API token      | the connection test accepted a wrong API token        |
        | names no network host                                  | the manifest names no network host                    |
        | shows the API token in the approval of "delete a list" | the API token reached the approval of "delete a list" |
        | cannot summarize "add a task"                          | "add a task" asked for no approval                    |
        | shows the share password in the open tasks of a list   | the share password reached the agent                  |
        | shows the share password when it deletes a list        | the share password reached the agent                  |

  Rule: A plugin author specifies behavior of the plugin with the steps of the suite

    Scenario: A feature of Acme Tasks runs in the same harness as the compliance suite
      Given plugin author 3 writes a feature of Acme Tasks for "show the open tasks" with the steps of the compliance suite
      When plugin author 3 runs that feature
      Then the feature passes against the fake Acme in the plugin harness
