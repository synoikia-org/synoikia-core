@id:portal-my-instances
Feature: My instances in the portal
  A person without the admin role sees the instances of their role and their own profile, and nothing else.
  The role decides on each instance whether the person may lower levels for their own calls.
  It also decides whether they may keep their own pre-approval rules there.
  Their own levels never go above the most the role allows.

  Rule: A non-admin sees only their instances and their profile

    Scenario: User 12 lands on My instances with /tasks and its address
      Given user 12 has the role "family", which has the instance /tasks
      And the server's public address is "https://mcp.acme.example"
      When user 12 signs in to the portal
      Then user 12 sees My instances with "https://mcp.acme.example/tasks", and no other instances
      And the menu offers user 12 only /tasks and "My profile"

    Scenario: An admin page sends user 12 back to My instances
      Given user 12 has the role "family", which has the instance /tasks
      When user 12 opens the user list in the portal
      Then the portal shows My instances to user 12 instead

    Scenario: Other instances show by name only, and their page says to ask an admin
      Given user 12 has the role "family", which has the instance /tasks
      And the role "family" may see other instances, and the instance /shopping exists
      When user 12 opens /shopping from My instances
      Then the page of /shopping says that user 12 has no access and should contact an administrator
      And My instances listed /shopping without its address

  Rule: Personal levels are offered where the role allows, capped by it

    Scenario: Without personal levels, user 12 sees the levels but cannot change them
      Given user 12 has the role "family", which has the instance /tasks
      And "family" may at most Ask in the group "tasks" of /tasks
      When user 12 opens /tasks in the portal
      Then user 12 sees the group "tasks" at Ask, with no level to pick

    Scenario: With personal levels, user 12 lowers "lists" to Read, and Write stays out of reach
      Given user 12 has the role "family", which has the instance /tasks with personal levels
      And "family" may at most Ask in the group "lists" of /tasks
      When user 12 sets the group "lists" of /tasks to Read
      Then user 12's own level for the group "lists" of /tasks is Read
      And user 12 cannot pick Write for the group "lists"

    Scenario: An operation the role keeps at None shows as Off
      Given user 12 has the role "family", which has the instance /tasks with personal levels and its status
      And "family" may at most Ask in the group "tasks" of /tasks, but nothing for "add a task"
      When user 12 opens /tasks in the portal
      Then "add a task" shows "Off", with no level to pick

  Rule: Own rules appear only where the role allows them

    Scenario: The rules show on /tasks, where the role allows them, and not on /shopping
      Given user 12 has the role "family", which has the instances /tasks and /shopping
      And "family" may keep own rules on /tasks
      When user 12 opens /tasks and then /shopping in the portal
      Then only /tasks offered "My pre-approval rules"

    Scenario: The rule editor reads only what user 12 may see of /tasks
      Given user 12 has the role "family", which has the instance /tasks
      And "family" may keep own rules on /tasks, and may at most Ask in the group "tasks"
      When user 12 starts a rule for "complete a task" on /tasks
      Then the rule editor offers the list "Groceries"
      And the portal asked the server for no admin data
