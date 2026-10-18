@id:upstream-http-client
Feature: Upstream client
  The "Acme Tasks" plugin of plugin author 3 calls Acme Tasks through the client of the SDK.
  The client adds the credentials, stays on the upstream it was given and keeps within its limits.
  Its errors name the call, never the credentials.

  Background:
    Given Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And the plugin connects to Acme Tasks with the API token "acme-tok-9f8e7d6c"

  Rule: Requests carry credentials, and reads carry no body

    Scenario: An add sends the token and the task
      When the plugin adds "butter" to "Groceries"
      Then Acme Tasks receives the task "butter" with the token "acme-tok-9f8e7d6c"
      And the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"

    Scenario: A read sends no body, even when the plugin gives one
      When the plugin reads the open tasks of "Groceries" and gives the task "butter" with the read
      Then Acme Tasks receives the read with no body
      And the plugin gets "milk", "bread" and "eggs"

    Scenario: An empty answer gives nothing, and a text answer stays text
      When the plugin completes "milk" in "Groceries" and asks for the version of Acme Tasks
      Then the completion gives nothing
      And the version reads "Acme Tasks 4.2"

  Rule: Upstream errors reach the plugin without credentials

    Scenario Outline: A refusal or a failure of Acme Tasks names the call but not the token
      Given <situation>
      When the plugin reads the open tasks of "<list>"
      Then the plugin gets <error>
      And no error holds the token "acme-tok-9f8e7d6c"

      Examples:
        | situation                                                   | list      | error                                                                             |
        | the plugin connects with the revoked API token "acme-tok-0000" | Groceries | the denied error "Acme Tasks denied" and "insufficient permission (token revoked)" |
        | Acme Tasks fails reads of "Broken" with "storage offline"    | Broken    | the upstream error "500 (storage offline)"                                        |

    Scenario: An invalid task names the field that Acme Tasks refused
      When the plugin adds "" to "Groceries"
      Then the plugin gets the invalid-parameters error "title is required"

    Scenario: A long upstream message is clipped to 300 characters
      Given Acme Tasks fails reads of "Broken" with a message of 1000 copies of "x"
      When the plugin reads the open tasks of "Broken"
      Then the plugin gets an error whose text from Acme Tasks stops after 300 characters with "…"

  Rule: The client stays on its upstream and within its limits

    Scenario: A redirect to another host is refused, and that host is never contacted
      When the plugin reads a page of Acme Tasks that moved to another host
      Then the plugin gets the upstream error "302"
      And the other host gets no request

    Scenario Outline: A large, slow or missing upstream gives a clear error
      Given <situation>
      When the plugin reads the open tasks of "Groceries"
      Then the plugin gets the upstream error "<error>"

      Examples:
        | situation                                                  | error                                  |
        | the plugin accepts answers of at most 1024 bytes, and Acme Tasks answers with 2048 | response too large |
        | the plugin waits 50 milliseconds, and Acme Tasks answers after 500 | timed out                       |
        | Acme Tasks is down                                          | Acme Tasks is unreachable at 127.0.0.1: |

    Scenario Outline: A path that leaves the upstream is refused before any request
      When the plugin reads the path "<path>"
      Then the plugin gets the invalid-parameters error "invalid path"
      And Acme Tasks gets no request

      Examples:
        | path                 |
        | /../../etc           |
        | /lists/%2e%2e/x      |
        | @other-host/lists    |

  Rule: Session sign-in happens once, and once more after a refusal

    Scenario: Two reads sign in once
      Given Acme Tasks takes a session sign-in instead of the token
      When the plugin reads the open tasks of "Groceries" twice
      Then the plugin signed in to Acme Tasks once
      And the plugin gets "milk", "bread" and "eggs"

    Scenario: An ended session signs in once more
      Given Acme Tasks takes a session sign-in instead of the token
      And the plugin read the open tasks of "Groceries" once
      And Acme Tasks ends every session
      When the plugin reads the open tasks of "Groceries"
      Then the plugin signed in to Acme Tasks twice, and gets "milk", "bread" and "eggs"

    Scenario: The cookie of a sign-in is readable
      Given Acme Tasks takes a session sign-in instead of the token
      When the plugin signs in with the user "author3" and the phrase "acme sign-in phrase"
      Then Acme Tasks receives the form "username=author3&password=acme+sign-in+phrase"
      And the plugin reads the cookie "sid=s1", marked "HttpOnly"

  Rule: Form bodies are encoded exactly and checked before they are sent

    Scenario: Form fields are encoded exactly
      When the plugin sends the task "milk & eggs = 2" with the tags "dairy" and "urgent", not done, as form fields
      Then Acme Tasks receives the form "title=milk+%26+eggs+%3D+2&tags=dairy&tags=urgent&done=false"

    Scenario: Multipart fields have safe names and a new random boundary each time
      When the plugin sends the field 'we"ird' with "é" and the field "notes" with two lines, twice as multipart fields
      Then Acme Tasks receives the parts "we%22ird" and "notes" with their values unchanged
      And the two sends use different random boundaries

    Scenario Outline: A body that is not a set of fields is refused, and nothing is sent
      When the plugin sends <body> as <encoding>
      Then the plugin gets the invalid-parameters error "<error>"
      And Acme Tasks gets no request

      Examples:
        | body             | encoding         | error                     |
        | the text "milk"  | form fields      | must be an object of fields |
        | a list of tasks  | multipart fields | must be an object of fields |
        | a task           | "xml"            | Unknown body encoding     |

  Rule: Base addresses are parsed strictly

    Scenario Outline: A base address that is not one, or has another scheme, is refused
      When the plugin joins "/api" to the base address "<base>" for <use>
      Then the base address is refused with "<reason>"

      Examples:
        | base            | use         | reason                    |
        | not an address  | plain calls | is not a valid            |
        | ftp://tasks.lan | plain calls | Unsupported URL scheme ftp: |
        | ws://tasks.lan  | plain calls | Unsupported URL scheme ws:  |

    Scenario Outline: Credentials, query and fragment are dropped, and a live channel switches the scheme
      When the plugin joins "<path>" to the base address "<base>" for <use>
      Then the plugin gets the address "<address>"

      Examples:
        | base                                              | path           | use           | address                           |
        | https://author3:secret@tasks.lan:8443/x/?q=1#f    | /api           | plain calls   | https://tasks.lan:8443/x/api      |
        | https://tasks.lan:8123/                           | /api/websocket | a live channel | wss://tasks.lan:8123/api/websocket |
        | http://tasks.lan                                  | /api/current   | a live channel | ws://tasks.lan/api/current        |
        | wss://tasks.lan                                   | /api/current   | a live channel | wss://tasks.lan/api/current       |
