@id:stored-settings-upgrade
Feature: Stored settings from an earlier release
  An earlier release may have stored a setting that the new release refuses.
  Core then reads that setting as its default, and keeps the other settings.
  A setting that controls access is read as closed, never as open.

  Rule: A stored value the new release refuses reads as its default

    Scenario: A refused access token lifetime reads as one hour, and the other values stay
      Given the data file of an earlier release stores an agent access token lifetime of 1 minute
      When core starts on that data file
      Then the agent access tokens last one hour, and the other agent settings stay as stored
      And the server log warns that it ignores the stored lifetime

    Scenario: Agent sign-in methods that cannot be read are all off
      Given the data file of an earlier release stores the agent sign-in methods as "all"
      When core starts on that data file
      Then credentials, OAuth and the access gateway are all off for agents

    Scenario: At the start, refused values are removed once, and "tasks" keeps serving
      Given the data file of an earlier release stores a run limit of 0 for "tasks"
      When core starts on that data file
      Then "tasks" serves with the default run limit, and the data file holds no run limit for it
