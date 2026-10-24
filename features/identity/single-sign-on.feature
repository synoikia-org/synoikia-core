@id:single-sign-on
Feature: Single sign-on
  The admin can let people sign in with an identity provider, here Acme ID.
  An identity signs in as the user who linked it, or as a new user when the admin allows automatic users.
  The allow policy of the admin decides which identities may sign in at all.

  Background:
    Given user 12 has the role "family"
    And user 15 has the role "family"
    And the admin set up single sign-on with Acme ID

  Rule: Single sign-on works only while it is on

    Scenario: Nobody signs in with Acme ID while single sign-on is off
      Given the admin turned single sign-on off
      When user 12 signs in with Acme ID
      Then user 12 is told that single sign-on is not enabled

  Rule: The issuer and the client count only while single sign-on is on

    Scenario: Single sign-on saves as off without an issuer and a client
      When the admin saves single sign-on as off, with no issuer and no client
      Then single sign-on is off on the server, with no issuer and no client

    Scenario: Single sign-on does not turn on without an issuer and a client
      When the admin tries to turn single sign-on on, with no issuer and no client
      Then the admin is told that the issuer and the client are not valid, and single sign-on stays as it was

  Rule: A linked identity signs in as its user

    Scenario: User 12 signs in with their linked Acme ID
      Given user 12 linked their Acme ID
      When user 12 signs in with Acme ID
      Then user 12 lands in the portal

    Scenario: An identity that nobody linked is not allowed
      When someone signs in with the Acme ID "acme-99" that no user linked
      Then the sign-in with Acme ID is refused as not allowed
      And the audit log shows the refused sign-in of the Acme ID "acme-99"

    Scenario: A disabled user cannot sign in with Acme ID
      Given user 12 linked their Acme ID
      And the admin disables user 12
      When user 12 signs in with Acme ID
      Then the sign-in with Acme ID is refused as not allowed

  Rule: The allow policy also binds linked users

    Scenario: A linked user outside the allowed group is refused
      Given user 12 linked their Acme ID
      And the admin allows only the Acme ID group "mcp-admins"
      When user 12 signs in with Acme ID
      Then the sign-in with Acme ID is refused as not allowed

  Rule: An address counts only when Acme ID verified it

    Scenario: An address that Acme ID did not verify does not match
      Given user 12 linked their Acme ID
      And the admin allows only the address "user12@acme.example"
      When user 12 signs in with Acme ID, which says that the address is not verified
      Then the sign-in with Acme ID is refused as not allowed

    Scenario: An address without a word on its verification does not match
      Given user 12 linked their Acme ID
      And the admin allows only the address "user12@acme.example"
      When user 12 signs in with Acme ID, which says nothing about the verification of the address
      Then the sign-in with Acme ID is refused as not allowed

    Scenario: A verified address matches
      Given user 12 linked their Acme ID
      And the admin allows only the address "user12@acme.example"
      When user 12 signs in with Acme ID
      Then user 12 lands in the portal

  Rule: An address entry is an exact address or a whole domain

    Scenario: Entries match addresses in any case
      Given user 12 linked their Acme ID
      And the admin allows only "Admin@Example.com" and "*@corp.example"
      When user 12 signs in with Acme ID as "admin@example.COM" and then as "Anyone@CORP.example"
      Then user 12 lands in the portal both times

    Scenario: A domain entry matches no other domain
      Given user 12 linked their Acme ID
      And the admin allows only "*@corp.example"
      When user 12 signs in with Acme ID as "a@sub.corp.example", "a@corp.example.evil.com" and "corp.example@evil.com"
      Then the sign-in with Acme ID is refused as not allowed each time

    Scenario: Entries that are neither an address nor a domain are refused
      When the admin tries to allow "*.example.com", "a*@x.com" and "*@*"
      Then the admin is told each time that the entry is not valid

  Rule: Automatic users need an allow policy and a default role

    Scenario: Automatic users without an allow policy are refused
      When the admin turns on automatic users with an empty allow policy
      Then the admin is told "Auto-provisioning needs an allow policy"

    Scenario: Automatic users without a default role make no account
      Given the admin turns on automatic users for the Acme ID group "family-members"
      When "new.person" signs in with Acme ID in the group "family-members"
      Then the sign-in with Acme ID is refused as not allowed
      And the server has no account "new.person"

  Rule: An automatic user gets the default role and a free name

    Scenario: A new person gets an account with the default role
      Given the admin turns on automatic users for the Acme ID group "family-members"
      And the default role for new users is "family"
      When "new.person" signs in with Acme ID in the group "family-members"
      Then "new.person" lands in the portal with the role "family"

    Scenario: A taken name gets a number
      Given the admin turns on automatic users for the Acme ID group "family-members"
      And the default role for new users is "family"
      And the admin made the user "new.person"
      When "new.person" signs in with Acme ID in the group "family-members"
      Then "new.person-2" lands in the portal with the role "family"

    Scenario: A name taken in other letter case gets a number
      Given the admin turns on automatic users for the Acme ID group "family-members"
      And the default role for new users is "family"
      And the admin made the user "New.Person"
      When "new.person" signs in with Acme ID in the group "family-members"
      Then "new.person-2" lands in the portal with the role "family"

  Rule: A tampered sign-in with Acme ID fails

    Scenario: A forged or expired sign-in state is refused
      When user 12 comes back from Acme ID to the consent page with a forged state, and then with a state 11 minutes old
      Then user 12 is told both times that the sign-in expired or is invalid

    Scenario: A proof made for the code step is refused
      Given user 12 has an authenticator app
      When user 12 comes back from Acme ID to the consent page with the proof of their code step as the state
      Then user 12 is told that the sign-in expired or is invalid

    Scenario: The reason of Acme ID is shown when it refuses the code
      Given Acme ID refuses every code with "the code has expired"
      When user 12 signs in with Acme ID on the consent page
      Then user 12 sees "invalid_grant: the code has expired"

    Scenario: An identity token that expired is refused
      Given user 12 linked their Acme ID
      And Acme ID gives an identity token that expired 10 minutes ago
      When user 12 signs in with Acme ID
      Then the sign-in with Acme ID fails, and user 12 is not signed in

  Rule: Sign-in with Acme ID returns only to a page of the portal

    Scenario: User 12 comes back to the page they started from
      Given user 12 linked their Acme ID
      When user 12 signs in with Acme ID from the page "/audit"
      Then user 12 lands on "/audit"

    Scenario: A return to another site lands on the portal home
      Given user 12 linked their Acme ID
      When user 12 signs in with Acme ID from links that return to "/\attacker.example" and to a tab and "/attacker.example"
      Then user 12 lands on the portal home both times

  Rule: A user links an identity only for themselves

    Scenario: User 12 links their Acme ID in their profile
      When user 12 links their Acme ID in their profile
      Then user 12 comes back to their profile, linked to Acme ID

    Scenario: A link finished in another browser links nobody
      When user 12 starts to link their Acme ID, and the link is finished where nobody or user 15 is signed in
      Then both browsers are told that the session changed, and nobody is linked

    Scenario: A changed, expired or foreign proof links nobody
      Given user 12 has an authenticator app
      When user 12 finishes a link with a changed proof, an expired proof and the proof of their code step
      Then user 12 is told each time that the session changed, and is not linked

  Rule: A link must be allowed and free

    Scenario: The allow policy refuses the identity
      Given the admin allows only the Acme ID group "mcp-admins"
      When user 12 links their Acme ID in their profile
      Then user 12 is told that the identity is not allowed, and is not linked

    Scenario: An identity of another user is taken
      Given user 15 linked the Acme ID of user 12
      When user 12 links their Acme ID in their profile
      Then user 12 is told that the identity is taken, and is not linked

  Rule: Unlinking needs a password

    Scenario: A user without a password cannot unlink
      Given the admin turns on automatic users for the Acme ID group "family-members"
      And the default role for new users is "family"
      And "new.person" signed in with Acme ID in the group "family-members"
      When "new.person" unlinks their Acme ID
      Then "new.person" is told "Set a password before unlinking single sign-on"

    Scenario: A user with a password unlinks
      Given user 12 linked their Acme ID
      When user 12 unlinks their Acme ID
      Then user 12 is no longer linked to Acme ID
