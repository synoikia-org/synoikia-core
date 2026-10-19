@id:client-policy
Feature: App name policy
  The admin can let only some apps connect by the name each app gives for itself, or refuse some by name.
  The name is what the app says it is. The policy is a convenience and not a security boundary.

  Background:
    Given user 12 has the role "family", which has the instance "tasks"
    And agent 9 belongs to user 12 and may read and write

  Rule: Allow mode lets only the listed names connect

    Scenario: Without a policy, any name connects
      When agent 9 connects to "tasks" as "anything at all"
      Then agent 9 gets a session as "anything at all"

    Scenario: A listed name connects in any case
      Given the admin lets only the app "Listed-Client" connect
      When agent 9 connects to "tasks" as "listed-client"
      Then agent 9 gets a session as "listed-client"

    Scenario: Other names, no name and a number are refused and audited
      Given the admin lets only the app "Listed-Client" connect
      When agent 9 connects to "tasks" as "other-client", with no name, and with the number 42
      Then each time agent 9 is told that the app is not allowed on this server
      And the audit log shows the refusals of "other-client" and of two apps with no name

  Rule: Deny mode refuses the listed names

    Scenario: A refused name is refused in any case and in a batch of one, and the server log names it
      Given the admin refuses the app "blocked"
      When agent 9 connects to "tasks" as "BLOCKED", as "BLOCKED" in a batch of one message, and as "fine"
      Then the first two are told that the app is not allowed, "fine" gets a session, and the server log names "BLOCKED"

    Scenario: A session of a name that the admin then refuses ends, also after the policy is off again
      Given agent 9 has a session on "tasks" as "e2e"
      And the admin refuses the app "e2e"
      When agent 9 continues its session, and again after the admin turned the policy off
      Then agent 9 is told first that the app is not allowed, and then that the session does not exist

    Scenario: A refused app can neither listen on its session nor end it
      Given agent 9 has two sessions on "tasks" as "e2e"
      And the admin refuses the app "e2e"
      When agent 9 listens on its first session, and ends its second session
      Then each time agent 9 is told that the app is not allowed on this server

  Rule: The name list is tidy and limited

    Scenario: The same name is kept once, and switching the mode keeps the list
      When the admin lets only " Client-A " and "client-a" connect, and then switches to refusing them
      Then the policy refuses only "Client-A"

    Scenario: A list that breaks the limits is refused
      When the admin tries an allow list with no name, an empty name, a name of 101 characters or 51 names, and the mode "maybe"
      Then the admin is told each time that the policy is not valid, and the policy stays off

  Rule: The admin sees the last 50 names that connected

    Scenario: The admin sees 50 names, newest first, once each in any case, with the latest version
      When agent 9 connects to "tasks" as "app-1" to "app-51", and then as "APP-51" with the version "2.0"
      Then the admin sees 50 names from "APP-51" at version "2.0" back to "app-2"
      And user 12 may not see the names

    Scenario: Names are trimmed and clipped, and blank names are not kept
      When agent 9 connects to "tasks" as "  padded  ", as a name of 150 characters, and as "   "
      Then the admin sees "padded" and the first 100 characters of the long name, and no blank name

    Scenario: A broken or oversized first message is a transport error, not a refusal
      Given the admin refuses the app "blocked"
      When agent 9 sends a broken first message to "tasks", and then one over the size limit
      Then agent 9 is told that the message could not be read and that it is too large, and nothing is audited or kept
