@id:portal-help
Feature: Help for each page of the portal
  A person who runs the portal reads what a page is for and how it works from the page itself.
  The page shows only what the person acts on. The explanation is one step away, in the help of that page.

  Rule: A page shows what the person acts on, and its help explains it

    Scenario: The admin reads how matching works in the help of the rules of /groceries
      Given the admin has the rules of /groceries open
      When the admin opens the help
      Then the admin reads "Pre-Approval Rules", with "How matching works" in it
      And the rules page itself does not explain matching

    Scenario: User 12 reads how to connect a client in the help of My instances
      Given user 12 has the role "family", which has the instance /tasks
      When user 12 opens the help on My instances
      Then user 12 reads "My instances", with "Connect a client" in it

    Scenario: Escape closes the help and puts the focus back where the admin was
      Given the admin has the help of the rules of /groceries open
      When the admin hits Escape
      Then the help is closed, with the focus on "Help for this page"

    Scenario: A new rule explains its fields in the help, not next to them
      Given the admin has a new rule open on /groceries
      When the admin reads the reason of the new rule
      Then the admin sees "Required. Shown in the audit log." and nothing more
      And the help of the rules says why a reason is needed

  Rule: The help leads to other help without leaving the page

    Scenario: The admin finds the OIDC help from the rules of /groceries
      Given the admin has the help of the rules of /groceries open
      When the admin searches the help for "OIDC group"
      Then the admin reads "Let only one OIDC group sign in" from User auth, still on the rules of /groceries
      And one step takes the admin back to "Pre-Approval Rules"

    Scenario: The admin goes from the help on rules to the help on access levels
      Given the admin has the help of the rules of /groceries open
      When the admin follows the related help "Access"
      Then the admin reads "Access", with "Levels" in it, still on the rules of /groceries

  Rule: A part of a long help opens on its own

    Scenario: The help on matching opens over a new rule, and the draft stays
      Given the admin typed "household" in a new rule's reason on /groceries
      When the admin opens the help on "Only when"
      Then the admin reads "How matching works", with the new rule still open and "household" kept

    Scenario: Escape closes the help first and keeps the draft, then closes the dialog
      Given the admin typed "household" in a new rule's reason on /groceries and opened the help in it
      When the admin hits Escape twice
      Then the first Escape closed only the help, with "household" kept
      And the second Escape closed the dialog

  Rule: Help on what only an admin does stays with admins

    Scenario: User 12 finds no admin help in a search
      Given user 12 has the role "family", which has the instance /tasks
      When user 12 searches the help for "OIDC group"
      Then user 12 is told that no help matches "OIDC group"

    Scenario: User 12 reads the help of /tasks without the parts for admins
      Given user 12 has the role "family", which has the instance /tasks
      When user 12 opens the help on /tasks
      Then user 12 reads how their own levels work, and nothing on how an admin sets the levels of /tasks

  Rule: A reader can tell what the help describes, and suggest a fix

    Scenario: User 12 suggests an edit to the help of My instances
      Given user 12 has the help of My instances open
      When user 12 suggests an edit
      Then user 12 lands on GitHub, on the proposal of a change to the help of My instances

    Scenario: The help names the version of the server it describes
      Given the server runs Synoikia 0.22.1
      When the admin opens the help on the overview
      Then the help says it is for Synoikia 0.22.1
