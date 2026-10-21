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

## Claude Code

The `--claude` option adds a `CLAUDE.md` and Claude Code settings that enable the `synoikia-plugin-dev` plugin of the [Synoikia dev kit](https://github.com/synoikia-org/synoikia-dev-kit). A session start hook recommends the plugin when it is not loaded. A new repository has no workflow files. To build spec first and test first, adopt [NoVibe](https://github.com/novibe-org/novibe).

`@synoikia/create-plugin/vitest` exports `pluginFiles()`, the Vitest plugin that loads `.yaml` and `.md` imports as the bundle does.

Templates are plain files with `{{name}}` placeholders. Nothing in a template runs. The scaffold scenarios (`features/scaffold`) and the smoke test scaffold each archetype and auth pair between them. They run its generated tests against the workspace SDK and core.
