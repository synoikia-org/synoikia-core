@id:portal-accessibility
Feature: Keyboard and screen reader use of the portal
  A person who uses only the keyboard or a screen reader can do all that others do in the portal.
  Each new page takes the focus and says its name. Dialogs keep the focus inside.
  Tabs and option groups follow the arrow keys. Tables, results and controls have names a screen reader says.

  Rule: Keyboard users skip to the content and land on each new page

    Scenario: The first Tab offers to skip to the content
      Given the admin has the overview open
      When the admin uses "Skip to content" from the keyboard
      Then the focus is on the content of the page

    Scenario: A screen reader hears the name of each new page, but not of the first one
      Given the admin has the overview open
      When the admin goes to the audit log from the menu
      Then a screen reader heard nothing on the first page
      And a screen reader hears "Audit Log", with the focus on the content

    Scenario: The pages of an instance are named after it
      Given the admin has the connection page of /groceries open
      When the admin goes to the access page of /groceries
      Then a screen reader hears "Access · /groceries"

  Rule: The menu says where the person is, and Escape closes it on a small screen

    Scenario: The current instance is marked in the named menu
      When the admin opens the rules of /groceries
      Then the menu "Main" marks /groceries as the current page, and "Settings" is not marked

    Scenario: Escape closes the menu on a small screen and puts the focus back on Menu
      Given the admin has the overview open on a small screen, with the menu open
      When the admin hits Escape in the menu
      Then the menu is closed, with the focus on "Menu"

  Rule: Dialogs keep the focus inside and close on Escape

    Scenario: The focus starts in the first field, Tab wraps, and the page behind is out of reach
      When the admin opens the add dialog on the user list
      Then the focus is on "Username"
      And Tab from the last control goes to "Close", and the page behind the dialog is inert

    Scenario: Escape closes a tip first and keeps the draft, then closes the dialog
      Given the admin typed "household" in a new rule's reason on /groceries and opened a tip in it
      When the admin hits Escape twice
      Then the first Escape closed only the tip, with "household" kept
      And the second Escape closed the dialog

    Scenario: A question puts the focus on Cancel first
      Given the role "family"
      When the admin starts to delete "family" on the roles page
      Then the focus is on "Cancel"

  Rule: Tabs follow the arrow keys, Home and End

    Scenario: The plugin tabs move with the arrow keys, Home and End, with one Tab stop
      When the admin moves through the plugin tabs with the arrow keys, Home and End
      Then each key picked the expected tab, and only the picked tab takes Tab

    Scenario: The tabs of an instance on My instances move with the arrow keys
      Given user 12 has the role "family", which has the instance /groceries
      And "family" may keep own rules on /groceries
      When user 12 moves from "Access" to the next tab of /groceries with the right arrow
      Then "My pre-approval rules" is picked and focused, and its panel shows

  Rule: Option groups follow the arrow keys

    Scenario: The theme follows the arrow keys
      When the admin moves from "Auto" to the next theme with the down arrow on their profile
      Then the theme "Light" is picked and focused, and the portal is light

    Scenario: The access levels move the focus only
      Given the group "lists" of /groceries is at Ask
      When the admin moves through the levels of "lists" with the right arrow
      Then the focus moved to Write and then None, and "lists" is still at Ask

  Rule: Screen reader users hear names, busy states and results

    Scenario: Tables are named by their heading, with an Actions column and row actions tied to rows
      Given the admin has the bearer token "laptop"
      When the admin opens the clients page
      Then the tables are named "Bearer tokens", "OAuth clients" and "OAuth grants", each with an "Actions" column
      And the revoke of "laptop" is described by "laptop"

    Scenario: A save is said as a status, and a failure as an alert
      When the admin saves the client auth settings, then saves them with External and no Cloudflare Access
      Then a screen reader heard the status "Saved." and then an alert

    Scenario: Chips say what they add and remove
      When the admin adds "b, c" to the allowed clients and then removes "b"
      Then a screen reader heard "Added b, c" and then "Removed b"

  Rule: Controls are named, with their hints

    Scenario: Every control of the rule editor has a name
      When the admin starts a rule for "complete a task" on /groceries
      Then every control in the rule editor has a name

    Scenario: The single sign-on controls are named, and the allowed emails have their hint
      When the admin turns on single sign-on in the user auth settings
      Then every single sign-on control has a name, and "Allowed emails" is described by its hint

    Scenario: An audit row says whether it is open
      Given the instance /groceries
      When the admin opens the first event in the audit log
      Then the event says it is expanded, and its details show
