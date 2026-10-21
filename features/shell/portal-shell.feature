@id:portal-shell
Feature: The portal's menu and live updates
  The menu shows the version of the server, a link to report issues and the admin's sections in a fixed order.
  Live events from the server refresh what the admin sees without a reload.

  Rule: The menu shows the version, the issues link and the sections in order

    Scenario: The admin's menu ends with Settings, the audit log and the profile
      When the admin opens the portal
      Then the menu starts with "Overview" and ends with "Clients & Tokens", "Settings", "Audit Log" and "My profile"
      And the menu shows the version of the server and a link to report issues

  Rule: Live events refresh the overview

    Scenario: An instance that another admin makes shows on the overview without a reload
      Given the admin has the overview open
      When another admin makes the instance /shopping
      Then the overview lists /shopping without a reload
