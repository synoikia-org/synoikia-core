# @synoikia/create-plugin

Create [Synoikia](https://github.com/via-justa/synoikia-core) plugin repositories and plugins, then build, check and publish them. Guide: [`docs/plugin-authoring.md`](https://github.com/via-justa/synoikia-core/blob/main/docs/plugin-authoring.md).

```sh
pnpm create @synoikia/plugin my-plugins [--repository owner/name] [--release] [--claude]
```

Inside a plugin repository (a root devDependency; `pnpm new` maps to `synoikia-plugin new`):

| Command                                             | What                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `synoikia-plugin new`                               | Add a plugin: `--id --name --archetype --auth [--api-key-header] --yes`   |
| `synoikia-plugin build [dir]`                       | Bundle a plugin into `dist/index.js`, `plugin.yaml` validated and inlined |
| `synoikia-plugin check [dir…]`                      | Manifest, `plugin.yaml` and version checks                                |
| `synoikia-plugin repo pack\|index\|verify\|publish` | The signed plugin repository steps a release workflow runs                |
| `synoikia-plugin workflow <command>`                | The spec- and test-first checks, git hooks and shared files (below)       |

## Workflow

Every new repository gets the spec- and test-first workflow. `docs/workflow.md` holds the rules. The git hooks and `.github/workflows/workflow.yml` run the checks. With `--claude`, the workflow skills and a branch-name hook come too. `pnpm workflow sync` brings a repository's copies up to date with this package. `synoikia.workflow` in the root `package.json` sets the paths the checks use.

| Command                                     | What                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `workflow check-branch [name]`              | `<component>/<two to four words>`                                      |
| `workflow check-phases --base <ref>`        | One phase per commit. `--red-green` runs the scenarios at `test:`      |
| `workflow check-features [--base <ref>]`    | Feature file rules. With `--base`: the slice size and new test files   |
| `workflow check-prose [--base <ref>]`       | The writing rules on added lines, files or the PR description          |
| `workflow check-security-line --base <ref>` | A `Security audit:` line when a ready PR changes a security path       |
| `workflow pre-commit`, `workflow pre-push`  | What the git hooks run                                                 |
| `workflow hooks install`, `workflow sync`   | Use `.githooks` in this clone. Write or check (`--check`) shared files |

`@synoikia/create-plugin/vitest` exports `pluginFiles()`, the Vitest plugin that loads `.yaml` and `.md` imports as the bundle does.

Templates are plain files with `{{name}}` placeholders; nothing in a template runs. A smoke test scaffolds every archetype and runs its generated tests against the workspace SDK and core.
