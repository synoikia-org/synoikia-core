@id:repository-release
Feature: Repository release
  Plugin author 3 releases the plugins of the repository "acme/plugins" as a signed plugin repository.
  The release workflow packs each new version, signs the archives and builds the index.
  It then checks the release as core installs it, and publishes it on GitHub.
  A released version never changes.

  Rule: Packing is repeatable and ships only release files

    Background:
      Given plugin author 3 has the plugin repository "acme/plugins" with the plugin "acme-tasks" version "0.1.0"

    Scenario: Two packs of the same sources give the same archive
      When plugin author 3 packs the repository twice
      Then both packs give the archive "acme-tasks-0.1.0.tgz" with the same checksum

    Scenario: The archive holds only what core installs
      Given the manifest of "acme-tasks" names the instructions file "docs/agent.md"
      When plugin author 3 packs the repository
      Then the archive "acme-tasks-0.1.0.tgz" holds only these files:
        | dist/index.js |
        | docs/agent.md |
        | manifest.json |
        | package.json  |

    Scenario: A plugin that fails its checks is refused before the build
      Given the manifest of "acme-tasks" lists no sensitive keys
      When plugin author 3 packs the repository
      Then the pack fails with "plugins/acme-tasks: connection.token: a secret field must be listed in sensitiveKeys"
      And no bundle and no archive are written

  Rule: The index lists only signed archives

    Background:
      Given plugin author 3 has the plugin repository "acme/plugins" with the plugin "acme-tasks" version "0.1.0"
      And plugin author 3 has packed the repository

    Scenario: An archive without a signature is refused
      When plugin author 3 builds the index
      Then the index fails with "acme-tasks-0.1.0.tgz is not signed"

    Scenario: A signed archive is listed with its address and its signature
      Given plugin author 3 has signed the archives with the key of the repository
      When plugin author 3 builds the index
      Then the index lists "acme-tasks" version "0.1.0" at "https://github.com/acme/plugins/releases/download/acme-tasks-v0.1.0/acme-tasks-0.1.0.tgz"
      And the index holds the signature of the archive and the public key of the repository

  Rule: A release extends the published index only under the same key

    Background:
      Given plugin author 3 has the plugin repository "acme/plugins" with the plugin "acme-tasks" version "0.1.0"

    Scenario: A version that is released already is skipped
      Given the published index lists "acme-tasks" version "0.1.0" under the key of the repository
      When plugin author 3 packs the repository
      Then the pack reports "nothing new to release" and writes no archive

    Scenario: A published index under another key is refused
      Given the published index lists "acme-tasks" version "0.0.9" under another key
      When plugin author 3 packs the repository
      Then the pack fails with "The published index has a different public key than minisign.pub"

    Scenario: A plugin whose package and manifest disagree on the version is refused
      Given the package of "acme-tasks" has the version "0.2.0"
      When plugin author 3 packs the repository
      Then the pack fails with "plugins/acme-tasks: package.json 0.2.0 and manifest.json 0.1.0 differ"

  Rule: The repository name comes from the repository package or the GitHub remote

    Background:
      Given plugin author 3 has the plugin repository "acme/plugins" with the plugin "acme-tasks" version "0.1.0"
      And the repository package names no repository

    Scenario: The GitHub remote names the repository
      Given the remote "origin" of the repository is "git@github.com:acme/plugins.git"
      When plugin author 3 packs, signs and indexes the repository
      Then the index lists "acme-tasks" version "0.1.0" at "https://github.com/acme/plugins/releases/download/acme-tasks-v0.1.0/acme-tasks-0.1.0.tgz"

    Scenario Outline: A remote that is not on GitHub, or not of the plugin repository, is refused
      Given <situation>
      When plugin author 3 packs the repository
      Then the pack fails with "Set \"synoikia\": { \"repository\": \"owner/name\" } in package.json, or pass --repository"

      Examples:
        | situation                                                                                                   |
        | the remote "origin" of the repository is "http://local_proxy@127.0.0.1:1/git/acme/plugins"                 |
        | the repository has no git folder of its own, in a checkout whose remote "origin" is "git@github.com:acme/outer.git" |

    Scenario: An invalid repository name is refused
      When plugin author 3 packs the repository as "not a repo"
      Then the pack fails with "Invalid repository not a repo"

  Rule: Publishing never changes a released archive

    Background:
      Given plugin author 3 has the plugin repository "acme/plugins" with the plugin "acme-tasks" version "0.1.0"
      And plugin author 3 has packed, signed and indexed the repository

    Scenario: A new version gets its own release, and the index release gets the new index
      When plugin author 3 publishes the repository
      Then GitHub has the release "acme-tasks-v0.1.0" with the archive and its signature
      And GitHub has the release "index" with the new index

    Scenario: An interrupted release with the same archive is resumed
      Given GitHub has the release "acme-tasks-v0.1.0" with the same archive and no signature
      When plugin author 3 publishes the repository
      Then GitHub has the release "acme-tasks-v0.1.0" with the archive and its signature
      And GitHub has the release "index" with the new index

    Scenario: A release with another archive is refused
      Given GitHub has the release "acme-tasks-v0.1.0" with another archive
      When plugin author 3 publishes the repository
      Then the publish fails with "acme-tasks-v0.1.0 is already released with different contents"
      And GitHub has no release "index"

  Rule: The check before publishing installs the release as core does

    Background:
      Given plugin author 3 has the plugin repository "acme/plugins" with the plugin "acme-tasks" version "0.1.0"
      And plugin author 3 has packed the repository

    Scenario: A release signed with the key of the repository is verified
      Given plugin author 3 has signed the archives with the key of the repository
      And plugin author 3 has built the index
      When plugin author 3 checks the release
      Then the check reports "verified acme-tasks@0.1.0"

    Scenario: A release signed with another key is refused
      Given plugin author 3 has signed the archives with another key
      And plugin author 3 has built the index
      When plugin author 3 checks the release
      Then the release check fails because "acme-tasks@0.1.0" is signed by a key other than the key of the repository
