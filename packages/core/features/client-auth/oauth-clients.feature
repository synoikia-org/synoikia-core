@id:oauth-clients
Feature: OAuth apps
  An app that signs agents in with OAuth registers itself, or the admin registers it.
  The server sends a browser back only to a return address that the app registered.

  Rule: Apps register themselves unless the admin closes it

    Scenario: An app registers itself with a secure return address
      Given the server has a public address for agents
      When the app "Acme Chat" registers itself with the return address "https://chat.acme.example/callback"
      Then "Acme Chat" gets an app id, and the admin sees "Acme Chat" among the apps

    Scenario: An app may return only to a secure address, or to an address on this machine
      Given the server has a public address for agents
      When the app "Acme Chat" registers itself with "javascript:alert(1)", "http://chat.acme.example/cb" and "http://127.0.0.1:8080/cb"
      Then the first two are refused as unacceptable return addresses, and the address on this machine is accepted

    Scenario: The admin closes self-registration
      Given the server has a public address for agents
      And the admin closes the self-registration of apps
      When the app "Acme Chat" registers itself with the return address "https://chat.acme.example/callback"
      Then "Acme Chat" is told to ask the administrator, and the server description offers no registration

  Rule: The admin registers and revokes apps

    Scenario: The admin registers an app with a secret
      Given the server has a public address for agents
      When the admin registers the app "Acme Chat" with two return addresses and a secret
      Then the admin sees the secret once, and the token service refuses "Acme Chat" without it

    Scenario: The admin revokes an app, and its sign-ins stop
      Given user 12 has the role "family", which has the instance "tasks"
      And user 12 let agent 9 in through the app "Acme Chat"
      When the admin revokes the app "Acme Chat"
      Then agent 9 is refused, and cannot renew its sign-in

  Rule: A bad sign-in request never sends the browser to an unknown address

    Scenario: A return address that the app did not register gets an error page
      Given the admin registered the app "Acme Chat"
      When a browser opens the sign-in of "Acme Chat" with the return address "https://evil.example/cb"
      Then the browser gets the page "Invalid redirect", and is not sent anywhere

    Scenario: A sign-in request without a proof key goes back to the app as invalid
      Given the admin registered the app "Acme Chat"
      When a browser opens the sign-in of "Acme Chat" without a proof key
      Then the browser goes back to "Acme Chat" with "invalid_request" and the state "acme-chat"

    Scenario: An unknown app or an unknown instance is refused
      Given the admin registered the app "Acme Chat"
      And the admin lets "shopping" take only credentials
      When a browser opens the sign-in of an unknown app, and of "Acme Chat" for "nope" and for "shopping"
      Then the browser gets the page "Unknown application", and then goes back to "Acme Chat" with "invalid_target" twice
