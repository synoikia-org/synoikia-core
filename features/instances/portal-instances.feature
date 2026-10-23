@id:portal-instances
Feature: Instances in the portal
  The admin makes an instance of a plugin and sets it up in the portal.
  Each instance has pages for its connection, its access levels, its pre-approval rules and its settings.
  Stored secrets never show. Risky choices ask first or need a clear opt-in.
  A form keeps what the admin typed while the portal loads fresh data in the background.

  Rule: A new instance starts from the only usable plugin

    Scenario: Acme Tasks is chosen, and the new instance opens on its connection page
      Given Acme Tasks is enabled
      When the admin makes the instance "groceries" in the portal
      Then Acme Tasks was chosen as the plugin before the admin picked one
      And the portal shows the connection page of /groceries

    Scenario: The typed path stays while the portal loads the plugins again
      Given Acme Tasks is enabled
      And the admin typed the path "groceries" for a new instance
      When the browser is offline for a minute and comes back
      Then the path still says "groceries", with Acme Tasks as the plugin

    Scenario: Approval in the agent session is off until the admin turns it on, with a warning
      Given Acme Tasks is enabled
      When the admin makes the instance "groceries" with approval in the agent session turned on
      Then the option was off at first, and the portal warned that a client "could then approve those calls itself"
      And /groceries approves Ask operations in the agent session

  Rule: Each group has a level, set without a question

    Scenario Outline: <level> on the group "lists" applies at once
      Given the group "lists" of /groceries is at Read
      When the admin sets the group "lists" to <level> on the access page of /groceries
      Then the group "lists" of /groceries is at <level>, and the portal asked nothing

      Examples:
        | level |
        | Ask   |
        | Write |

    Scenario: A group with an operation at its own level says so
      Given "show the open tasks" on /groceries has its own level Ask
      When the admin opens the access page of /groceries
      Then the group "lists" shows "1 with their own level"

    Scenario: Setting all groups asks once, and Cancel changes nothing
      When the admin sets all groups of /groceries to Write and cancels the question
      Then the question said "Operations with their own level go back to following their group."
      And every group of /groceries is still at Ask

  Rule: Operations offer only the levels their kind allows

    Scenario: A read offers None, Read and Ask, and a write offers None, Ask and Write
      Given Acme Tasks says that "show the open tasks" needs the scope "TASKS_READ"
      When the admin opens every group on the access page of /groceries
      Then "show the open tasks" offers None, Read and Ask, and its kind says "Requires TASKS_READ"
      And "add a task" offers None, Ask and Write

    Scenario: The locked "delete a list" offers no Write, and Ask asks first
      When the admin picks Ask for "delete a list" on /groceries and cancels the question
      Then the question said "every call needs your approval on the approval page, with a typed confirmation"
      And "delete a list" cannot be set to Write, and stays at None

  Rule: An operation's own level is set, reset and explained

    Scenario: Picking what the group gives puts the operation back on its group
      Given "complete a task" and "add a task" on /groceries have their own level None
      When the admin picks Ask for "complete a task" on /groceries, which its group "tasks" gives
      Then "complete a task" follows its group again, and it cannot be reset
      And "add a task" keeps its own level None, and it can be reset

    Scenario: Each operation says what a call does now
      Given "add a task" on /groceries has its own level None
      When the admin opens every group on the access page of /groceries
      Then "show the open tasks" says "Runs", "complete a task" says "Asks", and "add a task" says "Off"

  Rule: Group labels can be renamed

    Scenario: A new label is trimmed and saved
      When the admin renames the group "lists" of /groceries to " To-do lists "
      Then the group "lists" of /groceries is labelled "To-do lists"

    Scenario Outline: A rename that is cancelled or unchanged keeps the label
      When the admin renames the group "lists" of /groceries and <answers>
      Then the group "lists" of /groceries is labelled "lists"

      Examples:
        | answers                       |
        | cancels the question          |
        | keeps the label as it is      |

  Rule: An unknown instance is checked again before the portal says there is none

    Scenario: The portal says that /gone does not exist
      When the admin opens the access page of /gone
      Then the portal says that there is no instance at /gone

    Scenario: An instance made since the portal loaded its list opens without a reload
      Given the admin has the overview open, and the live updates of the portal are down
      And another admin made the instance /errands meanwhile
      When the admin goes to the access page of /errands without a reload
      Then the portal shows the access page of /errands

  Rule: Stored secrets are never shown, only replaced or cleared

    Scenario: The stored API token shows only its last characters
      When the admin opens the connection page of /groceries
      Then the token shows "Set · …7d6c", and its value is nowhere on the page
      And the admin can mark the token to be cleared, undo that, or type a replacement

    Scenario: A replaced token is saved, and the instance restarts with it
      When the admin replaces the token of /groceries with "acme-tok-0000aaaa" and saves the connection
      Then the portal says that the instance restarted with the new connection
      And the token shows "Set · …aaaa"

  Rule: Connection edits are kept until they are saved

    Scenario: An edit stays while the admin syncs the instance
      Given the admin changed the url on the connection page of /groceries
      When the admin syncs /groceries from its connection page
      Then the portal says "Synced: 0 new, 9 updated, 0 removed."
      And the url still has the admin's edit

    Scenario: A connection that cannot be loaded shows why in the form
      Given the manifest of Acme Tasks for /groceries is broken on the server
      When the admin opens the connection page of /groceries
      Then the connection form shows the alert "Plugin tasks is invalid"

  Rule: Setup steps follow the chosen client and sign-in method

    Scenario: With OAuth, Claude Code gets the add command and the step to authenticate
      Given /groceries accepts only OAuth, and the server's public address is "https://mcp.acme.example"
      When the admin opens the connection page of /groceries
      Then the setup for Claude Code shows the command "claude mcp add --transport http groceries https://mcp.acme.example/groceries"
      And the setup says to choose "Authenticate"

    Scenario: With bearer tokens, Claude Desktop gets a config file, and the portal remembers the client
      Given /groceries accepts only bearer tokens
      When the admin picks Claude Desktop to set up on the connection page of /groceries
      Then the setup shows a config with the header "Authorization:${AUTH}" and "Bearer <token>"
      And the portal offers Claude Desktop again on the next visit

    Scenario: Browser sign-ins come first, and the steps follow the method picked
      Given /groceries accepts bearer tokens and OAuth
      When the admin picks bearer tokens to sign in with on the connection page of /groceries
      Then the methods were offered as "OAuth" then "Bearer tokens"
      And the command for Claude Code now has the header "Authorization: Bearer <token>"

  Rule: The setup says when a client cannot connect

    Scenario: An instance without a usable method gets no steps
      Given /groceries accepts only External, which is turned off
      When the admin opens the connection page of /groceries
      Then the setup says the instance "refuses every call", and shows no command

    Scenario Outline: The Cloudflare MCP portal setup warns about <problem>
      Given <setup>
      When the admin picks Cloudflare MCP portal to set up on the connection page of /groceries
      Then the setup warns "<warning>"

      Examples:
        | problem                      | setup                                                         | warning                                                 |
        | a client without OAuth       | /groceries accepts only bearer tokens                         | Cloudflare MCP portals sign in to servers with OAuth.   |
        | clients that cannot register | MCP clients may not register themselves                       | Turn on Let MCP clients register themselves             |
        | an unknown public address    | /groceries accepts bearer tokens and OAuth                    | Synoikia doesn't know its public MCP address.           |

    Scenario: With everything in place, the setup has no warnings, and the address copies
      Given /groceries accepts only OAuth, and the server's public address is "https://mcp.acme.example"
      When the admin copies the address on the connection page of /groceries
      Then the copy of "https://mcp.acme.example/groceries" is confirmed with "Copied"
      And the setup for the Cloudflare MCP portal has no warnings

  Rule: Instance settings guard risky choices

    Scenario: Approval in the agent session needs a visible opt-in in the settings
      When the admin turns on approval in the agent session in the settings of /groceries and saves
      Then the option was off at first, and the portal warned that a client "could then approve those calls itself"
      And /groceries approves Ask operations in the agent session

    @backlog
    Scenario: Always on or more than an hour warns about memory
      When the admin picks always on for /groceries in the settings, saves, and then picks 2 hours and saves
      Then the portal warned both times that the server may use more memory, and /groceries stops after 2 hours

    Scenario: Deleting needs the typed path, and Enter in the question saves no settings
      When the admin types "groceries" in the delete question of /groceries and confirms with Enter
      Then /groceries still exists, with its settings unchanged
      And after Delete, /groceries is gone and the portal shows the overview

    Scenario: An unsaved display name stays while the portal loads fresh data
      Given the admin typed the display name "Weekly shop" in the settings of /groceries
      When /groceries syncs in the background
      Then the display name still says "Weekly shop"

  Rule: Accepted sign-in methods default to all enabled

    Scenario: A new instance accepts all enabled methods, and approvals sign in without a code
      When the admin opens the settings of /groceries
      Then /groceries accepts "All enabled methods"
      And the settings say approvers can use their Cloudflare Access identity, never an authenticator code

    Scenario: "Only these" starts from the enabled methods, and a method that is off cannot be picked
      When the admin picks "Only these" in the settings of /groceries
      Then "Bearer tokens" and "OAuth" are ticked
      And "External" cannot be ticked, as it is "(off under Client auth)"

    Scenario: A stored method that is off can be cleared
      Given /groceries accepts bearer tokens and External, which is turned off
      When the admin clears "External" in the settings of /groceries and saves
      Then "External" cannot be ticked again
      And /groceries now accepts only bearer tokens

  Rule: An instance with no usable method refuses every call

    Scenario: The settings say that the instance refuses every call
      Given /groceries accepts only External, which is turned off
      When the admin opens the settings of /groceries
      Then the settings warn that /groceries "refuses every call"

    Scenario: The overview flags the instance
      Given /groceries accepts only External, which is turned off
      When the admin opens the overview
      Then /groceries is flagged "No client auth", as it refuses calls

  Rule: Rule editing offers only the fields the plugin declares

    Scenario: A rule for "complete a task" in Groceries is saved as targets in that list
      When the admin makes a rule for "complete a task" on /groceries with the list "Groceries"
      Then the rule editor offered only the field "List" and the field for each task
      And the rules of /groceries show "List ∈ {Groceries}"

    Scenario: A rule for "add a task" is saved strictly
      When the admin makes a rule for "add a task" on /groceries for lists that start with "Groc" and any tags
      Then the rules of /groceries show that the list starts with "Groc" and that any tags are accepted

    Scenario: Every setting in the rule editor explains itself
      When the admin starts a rule for "add a task" on /groceries
      Then every setting in the rule editor has a tip, and the tip of the operation mentions "Ask"

  Rule: Rules are deleted after a question, and drafts stay

    Scenario: A rule is deleted only after the admin confirms
      Given /groceries has a rule for "add a task" with the reason "weekly shop"
      When the admin deletes that rule and confirms the question
      Then the question said "Delete the rule for tasks.add?"
      And /groceries has no rules

    Scenario: A draft reason stays while the portal loads the rules again
      Given /groceries has a rule for "add a task" with the reason "weekly shop"
      And the admin changed the reason of that rule to "daily shop" without saving
      When the browser is offline for a minute and comes back
      Then the reason still says "daily shop"
