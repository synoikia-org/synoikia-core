@id:portal-settings
Feature: Settings in the portal
  The settings have six sections, and each one saves on its own.
  Client auth keeps at least one method on. The client policy says that it is no security boundary.
  Choices that could make every new account an admin ask for a typed confirmation.

  Rule: The settings have six sections in a fixed order, and old links still work

    Scenario: The settings open on Client auth, with the six sections in order
      When the admin opens the settings
      Then the sections are "Client auth", "User auth", "Users", "Roles", "Notifications" and "Server settings"
      And "Client auth" is open

    Scenario Outline: An old link to <old> opens <page>
      When the admin follows an old link to "<old>"
      Then the portal shows <page>

      Examples:
        | old                | page                     |
        | /settings/security | the "User auth" section  |
        | /settings/mcp      | the "Client auth" section |
        | /settings/profile  | the profile of the admin |

  Rule: Client auth keeps one method on, and External needs Cloudflare Access

    Scenario: With every method off, nothing can be saved
      When the admin turns off every client auth method
      Then the settings warn "Enable at least one method"
      And the client auth settings cannot be saved

    Scenario: External without Cloudflare Access is refused with core's reason
      When the admin turns on External and saves the client auth settings
      Then the settings show the alert "configure Cloudflare Access before you enable external auth"

    Scenario: External with Cloudflare Access is saved
      When the admin turns on External with the team "acme.cloudflareaccess.com" and the audience "acme-aud" and saves
      Then the client auth settings say "Saved."
      And the server accepts External from the team "acme.cloudflareaccess.com"

  Rule: The client policy filters clients by name and says it is no security boundary

    Scenario: The policy warns that clients declare their own names
      When the admin opens the client auth settings
      Then the client policy warns that it "is not a security boundary"

    Scenario: An allow list with no names refuses every client and cannot be saved
      When the admin allows only listed clients and lists none
      Then the client policy warns "An empty allow list refuses every client."
      And the client auth settings cannot be saved

    Scenario: An allow list with "claude-code" is saved
      When the admin allows only the client "claude-code" and saves
      Then the server allows only the client "claude-code"

  Rule: User auth saves each section on its own

    Scenario: Sign-up as administrators needs "ADMIN" typed
      When the admin makes new accounts administrators and types "admin", then "ADMIN"
      Then the question said "New accounts will be administrators."
      And new accounts get the role "Admin" only after "ADMIN"

    Scenario: The sign-in section saves only its own fields
      When the admin picks "Admin" for new accounts, sets the idle timeout to 30 and saves only the sign-in section
      Then the server ends idle sessions after 30 minutes
      And new accounts still get no role

    Scenario: Single sign-on keeps typed values while it is off, and saves off
      When the admin types the issuer "https://id.acme.example/" and the client "synoikia" for single sign-on, turns it off and on, then off and saves
      Then the issuer still said "https://id.acme.example/" after the second turn on
      And single sign-on is off on the server, with that issuer

  Rule: Server settings and notification channels save or report on their own

    Scenario: The audit log keeps 90 days unless the admin changes it
      When the admin sets the audit log retention to 30 days
      Then the retention said "The default is 90 days." before
      And the server keeps the audit log for 30 days

    Scenario: A channel is deleted only after the admin confirms
      Given the notification channel "Phone"
      When the admin deletes "Phone" and confirms the question
      Then the question said "Delete Phone?"
      And there are no notification channels

    Scenario: A failed test of a channel is reported
      Given the notification channel "Phone", which nothing answers
      When the admin tests "Phone"
      Then the portal shows the alert "Test to Phone failed"
