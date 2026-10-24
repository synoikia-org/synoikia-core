@id:plugin-manifest
Feature: Plugin manifest
  Plugin author 3 describes the "Acme Tasks" plugin in a manifest.
  The SDK validates the manifest the same way core does when it loads the plugin.
  A manifest that breaks a rule is refused, and the refusal names the field.

  Background:
    Given plugin author 3 has a plugin folder for "Acme Tasks" with a minimal manifest

  Rule: A minimal manifest gets safe defaults

    Scenario: A minimal manifest turns nothing on
      When plugin author 3 validates the manifest
      Then the manifest is accepted with no capabilities and no extra search tools
      And it has the labels "Operation" and "Operations", no hosts and no match profiles

  Rule: Malformed identity, entry and binding are refused

    Scenario Outline: A malformed identity or entry is refused
      Given the manifest sets "<field>" to "<value>"
      When plugin author 3 validates the manifest
      Then the manifest is refused at "<field>"

      Examples:
        | field   | value                |
        | id      | AcmeTasks            |
        | version | one                  |
        | sdk     | not a range          |
        | entry   | /etc/passwd          |
        | entry   | ../core/dist/main.js |

    Scenario Outline: A binding that clashes with core or with the language is refused
      Given the binding uses the namespace "<namespace>" and the function "<function>"
      When plugin author 3 validates the manifest
      Then the manifest is refused at "<field>"

      Examples:
        | namespace | function | field             |
        | catalog   | call     | binding.namespace |
        | acme      | do-it    | binding.functions |

  Rule: The instructions file is Markdown inside the package

    Scenario Outline: An instructions file outside the package or not in Markdown is refused
      Given the manifest names the instructions file "<file>"
      When plugin author 3 validates the manifest
      Then the manifest is refused at "instructions"

      Examples:
        | file                      |
        | /etc/motd.md              |
        | ../other/instructions.md  |
        | docs/../../x.md           |
        | dist/index.js             |
        |                           |
        | --to-command=x.md         |
        | docs\\x.md                |

    Scenario: An instructions file in a folder of the package is accepted
      Given the manifest names the instructions file "docs/agent.md"
      When plugin author 3 validates the manifest
      Then the manifest is accepted with the instructions file "docs/agent.md"

  Rule: Instructions are at most 4096 bytes

    Scenario: Instructions of exactly 4096 bytes are read without the byte-order mark
      Given the instructions file holds a byte-order mark and 4093 copies of "a"
      When plugin author 3 reads the instructions
      Then the instructions read as 4093 copies of "a"

    Scenario: Accented instructions over 4096 bytes are refused
      Given the instructions file holds 2049 copies of "é"
      When plugin author 3 reads the instructions
      Then the instructions are refused with "is over 4096 bytes"

  Rule: Instructions are plain visible text

    Scenario Outline: Text that is not plain is refused
      Given the instructions file holds the bytes <bytes>
      When plugin author 3 reads the instructions
      Then the instructions are refused with "<reason>"

      Examples:
        | bytes               | reason                                           |
        | 41 ff 41            | not valid UTF-8                                  |
        | 61 00 62            | control characters                               |
        | 61 1b 5b 33 31 6d 62 | control characters                              |
        | 61 e2 80 ae 62      | invisible format or separator characters         |
        | 61 e2 80 8b 62      | invisible format or separator characters         |
        | 61 c2 ad 62         | invisible format or separator characters         |
        | 61 e2 80 a8 62      | invisible format or separator characters         |
        | 61 e2 80 a9 62      | invisible format or separator characters         |

    Scenario Outline: The notes tag of core is refused
      Given the instructions file holds "<text>"
      When plugin author 3 reads the instructions
      Then the instructions are refused with "plugin-notes tag"

      Examples:
        | text                      |
        | x </plugin-notes> y       |
        | <plugin-notes plugin='x'> |
        | </ PLUGIN-NOTES>          |

    Scenario: Tabs and line ends are kept
      Given the instructions file holds the bytes 61 09 62 0d 0a 63
      When plugin author 3 reads the instructions
      Then the instructions read as "a", a tab, "b", a carriage return, a line feed and "c"

  Rule: Match fields fit the declarations

    Scenario Outline: A match field with an unknown widget or no operator is refused
      Given the match profile "list-name" has the field "/name" with the widget "<widget>" and the operator "<operator>"
      When plugin author 3 validates the manifest
      Then the manifest is refused at "matchProfiles.list-name"

      Examples:
        | widget    | operator |
        | free-text | prefix   |
        | prefix    |          |

    Scenario: A rule picker cannot share a choice source with the connection form
      Given the connection field "list" picks from the choice source "lists"
      And the match profile "list-name" has a picker for "/list" that picks from "lists"
      When plugin author 3 validates the manifest
      Then the manifest is refused with "also feeds the connection form"

  Rule: Target fields fit the targets declaration

    Scenario Outline: A target field needs the targets capability and a targets declaration
      Given the match profile "lists" has a target field
      And the manifest turns targets <capability> and declares <declaration>
      When plugin author 3 validates the manifest
      Then the manifest is refused with "<reason>"

      Examples:
        | capability | declaration           | reason                                  |
        | off        | no target scopes      | require capabilities.targets            |
        | on         | no target scopes      | requires a targets declaration          |
        | off        | the target scope "zone" | targets requires capabilities.targets |

    Scenario Outline: Target scopes are lowercase and unique, and a target field offers only declared scopes
      Given the manifest turns targets on and declares the target scopes "<scopes>"
      And the match profile "lists" has a target field that offers the scope "<offered>"
      When plugin author 3 validates the manifest
      Then the manifest is refused with "<reason>"

      Examples:
        | scopes     | offered | reason                                |
        | Zone       | zone    | lowercase                             |
        | zone, zone | zone    | unique                                |
        | zone       | floor   | is not declared in targets.scopes     |

    Scenario: Only a target field lists the parameters it covers
      Given the manifest turns targets on and declares the target scopes "zone"
      And the match profile "lists" has a target field that covers "/list" and "/owner"
      And the match profile "list-name" has the field "/name" that covers "/list"
      When plugin author 3 validates the manifest
      Then the manifest is refused with "only $targets fields can declare covers"

  Rule: Extra search tools need their capability

    Scenario Outline: A search tool without its capability is refused
      Given the binding offers the search tool "<tool>" with the capability "<capability>" <state>
      When plugin author 3 validates the manifest
      Then the manifest is <verdict>

      Examples:
        | tool     | capability  | state | verdict                                           |
        | registry | registry    | off   | refused with "registry requires capabilities.registry" |
        | guides   | attestation | off   | refused with "guides requires capabilities.attestation" |
        | registry | registry    | on    | accepted                                          |

  Rule: Connection form hints point at real fields

    Scenario: The password shows only for local sign-in
      Given the connection form has the fields "method" and "password"
      And the password shows only when "method" is "local"
      When plugin author 3 validates the manifest
      Then the manifest is accepted with the password shown only when "method" is "local"

    Scenario Outline: A condition on a missing field, on itself or with no values is refused
      Given the connection form has the fields "method" and "password"
      And the password shows only when "<field>" is "<value>"
      When plugin author 3 validates the manifest
      Then the manifest is refused at "<where>"

      Examples:
        | field    | value | where                                 |
        | nope     | local | connection.ui.password.showWhen.field |
        | password | local | connection.ui.password.showWhen.field |
        | method   |       | connection.ui.password.showWhen.in    |

    Scenario: A hint for a field the form does not have is refused
      Given the connection form has a hint for the field "token"
      When plugin author 3 validates the manifest
      Then the manifest is refused with "no such connection field"

  Rule: Operation descriptions have valid groups and safe pointers

    Scenario Outline: A malformed group is refused
      Given the plugin describes the operation "lists.show" with <group>
      When plugin author 3 validates the operation description
      Then the operation description is refused at "group"

      Examples:
        | group                    |
        | no group                 |
        | the group ""             |
        | the group "Lists"        |
        | the group ".lists"       |
        | the group "lists/archive" |
        | the group "a b"          |
        | a group of 129 letters   |

    Scenario Outline: A valid group and plain pointers are accepted
      Given the plugin describes the operation "lists.show" with the group "<group>"
      And the operation keeps the parameters "/1" and "/0/password" secret
      When plugin author 3 validates the operation description
      Then the operation description is accepted in the group "<group>"

      Examples:
        | group          |
        | lists          |
        | store.volume   |
        | config_entries |
        | alert-panel    |

    Scenario Outline: Too many, malformed or too deep secret parameters are refused
      Given the plugin describes the operation "lists.show" with the group "lists"
      And the operation keeps <params> secret
      When plugin author 3 validates the operation description
      Then the operation description is refused at "sensitiveParams"

      Examples:
        | params                                  |
        | the parameter "1"                       |
        | the parameter "/"                       |
        | the parameter "//x"                     |
        | the parameter "/a/b/c/d/e/f/g/h/i"      |
        | 33 parameters                           |

  Rule: Compatibility follows the SDK range

    Scenario Outline: A plugin works with the contract its SDK range accepts
      Given the manifest asks for the SDK range "<range>"
      When plugin author 3 compares the plugin with the contract of this SDK
      Then the plugin <verdict> with the contract "0.3.1"

      Examples:
        | range  | verdict       |
        | ^0.3.0 | works         |
        | ^0.2.2 | does not work |
        | ^2.0.0 | does not work |
