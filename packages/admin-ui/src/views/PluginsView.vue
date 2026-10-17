<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { rovingKeydown } from '../a11y';
import { ApiError, errorText } from '../api';
import ModalDialog from '../components/ModalDialog.vue';
import PageHeader from '../components/PageHeader.vue';
import TypedConfirm from '../components/TypedConfirm.vue';
import { latestError } from '../composables/useApiMutation';
import { useConfirm } from '../composables/useConfirm';
import {
  useAddRepo,
  useAvailablePluginsQuery,
  useConfirmRepoKey,
  useInstallPlugin,
  useInstallUpload,
  usePluginsQuery,
  useRefreshRepo,
  useRemoveRepo,
  useReposQuery,
  useRescanPlugins,
  useRevertPlugin,
  useTogglePlugin,
  useUninstallPlugin,
  useUploadPlugin,
} from '../composables/usePlugins';
import { ago, describeHosts, formatDate } from '../format';
import type { AvailablePlugin, PluginRow, Repo, StagedUpload } from '../types';

const pluginsQuery = usePluginsQuery();
const availableQuery = useAvailablePluginsQuery();
const reposQuery = useReposQuery();
const togglePlugin = useTogglePlugin();
const uninstallPlugin = useUninstallPlugin();
const rescanPlugins = useRescanPlugins();
const refreshRepo = useRefreshRepo();
const removeRepo = useRemoveRepo();
const installPlugin = useInstallPlugin();
const addRepoMutation = useAddRepo();
const confirmRepoKey = useConfirmRepoKey();
const uploadPlugin = useUploadPlugin();
const installUpload = useInstallUpload();
const revertPlugin = useRevertPlugin();
const { confirm } = useConfirm();
const installBusy = installPlugin.isPending;
const installError = installPlugin.errorText;
const confirmError = confirmRepoKey.errorText;
const tab = ref<'installed' | 'available' | 'repos'>('installed');
const uid = useId();
const tabId = (t: string) => `${uid}-tab-${t}`;
const rowId = (a: AvailablePlugin) => `${uid}-a-${a.repoId}-${a.pluginId}`;
const notice = ref<string>();

// The three lists show together, once all have loaded.
const ready = computed(() => !!pluginsQuery.data.value && !!availableQuery.data.value && !!reposQuery.data.value);
const loading = computed(() => [pluginsQuery, availableQuery, reposQuery].some((q) => q.isPending.value));
const plugins = computed(() => (ready.value ? (pluginsQuery.data.value ?? []) : []));
const available = computed(() => (ready.value ? (availableQuery.data.value ?? []) : []));
const repos = computed(() => (ready.value ? (reposQuery.data.value ?? []) : []));

// One page alert: the latest action's failure, else a failed load.
const error = computed(() => {
  const loadError = pluginsQuery.error.value ?? availableQuery.error.value ?? reposQuery.error.value;
  return (
    latestError([togglePlugin, uninstallPlugin, rescanPlugins, refreshRepo, removeRepo]) ??
    (loadError ? errorText(loadError) : undefined)
  );
});

function act<V>(action: { mutate: (vars: V, options: { onSuccess: () => void }) => void }, vars: V, done?: string) {
  notice.value = undefined;
  action.mutate(vars, { onSuccess: () => (notice.value = done) });
}

const toggle = async (p: PluginRow) => {
  if (
    p.enabled &&
    p.instances &&
    !(await confirm({
      title: `Disabling ${p.pluginId} stops its ${p.instances} endpoint(s).`,
      message: 'Continue?',
      action: 'Disable',
      danger: true,
    }))
  )
    return;
  act(togglePlugin, p);
};
const uninstall = async (p: PluginRow) => {
  const ok = await confirm({
    title: `Uninstall ${p.pluginId}?`,
    message: 'Its files are deleted.',
    action: 'Uninstall',
    danger: true,
  });
  if (ok) act(uninstallPlugin, p, `${p.pluginId} uninstalled.`);
};
const rescan = () => act(rescanPlugins, undefined, 'Plugin directories rescanned.');

// ── install ──

const installing = ref<{ item: AvailablePlugin; version: string; confirm: string }>();
function openInstall(item: AvailablePlugin) {
  installPlugin.reset();
  installing.value = { item, version: item.latest ?? item.versions[0]?.version ?? '', confirm: '' };
}
const installRepo = computed(() => repos.value.find((r) => r.id === installing.value?.item.repoId));
function install() {
  const i = installing.value;
  if (!i) return;
  installPlugin.mutate(
    { repoId: i.item.repoId, pluginId: i.item.pluginId, version: i.version, confirm: i.confirm || undefined },
    {
      onSuccess: (row) => {
        installing.value = undefined;
        notice.value = installedNotice(i.item.pluginId, i.version, row.enabled);
      },
    },
  );
}

// New installs, and updates that change what the plugin may do, wait for the admin to enable them.
const installedNotice = (pluginId: string, version: string, enabled: boolean) =>
  enabled
    ? `${pluginId} ${version} installed.`
    : `${pluginId} ${version} installed, disabled. Review its capabilities and network hosts, then Enable it on the Installed tab.`;

const shortSha = (sha: string | null) => sha?.slice(0, 12) ?? '';

// ── install from file (design §4.6) ──

const fromFile = ref<{ file?: File; staged?: StagedUpload; confirm: string }>();
function openFromFile() {
  uploadPlugin.reset();
  installUpload.reset();
  fromFile.value = { confirm: '' };
}
function pickFile(e: Event) {
  const f = fromFile.value;
  if (!f) return;
  uploadPlugin.reset();
  installUpload.reset();
  fromFile.value = { file: (e.target as HTMLInputElement).files?.[0], confirm: '' };
}
function upload() {
  const file = fromFile.value?.file;
  if (!file) return;
  uploadPlugin.mutate(file, {
    onSuccess: (staged) => {
      if (fromFile.value?.file === file) fromFile.value = { file, staged, confirm: '' };
    },
  });
}
function installFromFile() {
  const f = fromFile.value;
  const staged = f?.staged;
  if (!f || !staged) return;
  installUpload.mutate(
    { uploadId: staged.uploadId, confirm: f.confirm },
    {
      onSuccess: (row) => {
        fromFile.value = undefined;
        notice.value = installedNotice(staged.pluginId, staged.version, row.enabled);
      },
      onError: (err) => {
        // The staged file is gone: the admin uploads it again.
        if (err instanceof ApiError && (err.code === 'upload_expired' || err.code === 'upload_not_found'))
          fromFile.value = { file: f.file, confirm: '' };
      },
    },
  );
}

// ── revert to the released version ──

const reverting = ref<{ plugin: PluginRow; repo?: Repo; confirm: string }>();
function openRevert(plugin: PluginRow) {
  revertPlugin.reset();
  reverting.value = { plugin, repo: repos.value.find((r) => r.id === plugin.repoId), confirm: '' };
}
function revert() {
  const r = reverting.value;
  const version = r?.plugin.manual?.releasedVersion;
  if (!r || !version) return;
  revertPlugin.mutate(
    { id: r.plugin.id, confirm: r.confirm || undefined },
    {
      onSuccess: (row) => {
        reverting.value = undefined;
        notice.value = installedNotice(r.plugin.pluginId, version, row.enabled);
      },
    },
  );
}

// ── repositories ──

const adding = ref<{
  url: string;
  signingMode: 'signed' | 'unsigned';
  offered?: { publicKey: string; keyId: string };
  pasted: string;
  note?: string;
}>();
function addRepo() {
  const a = adding.value;
  if (!a) return;
  addRepoMutation.mutate(
    {
      url: a.url.trim(),
      signingMode: a.signingMode,
      confirmPublicKey: a.signingMode === 'signed' && a.pasted ? a.pasted : undefined,
    },
    {
      onSuccess: () => {
        adding.value = undefined;
        notice.value = 'Repository added.';
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'confirm_key') {
          const d = err.details as { publicKey: string; keyId: string };
          adding.value = {
            ...a,
            offered: d,
            note: a.pasted ? 'That key does not match the key this repository publishes.' : undefined,
          };
        } else adding.value = { ...a, note: errorText(err) };
      },
    },
  );
}

const confirming = ref<{ repo: Repo; pasted: string }>();
function openConfirm(repo: Repo) {
  confirmRepoKey.reset();
  confirming.value = { repo, pasted: '' };
}
function confirmKey() {
  const c = confirming.value;
  if (!c) return;
  confirmRepoKey.mutate({ id: c.repo.id, publicKey: c.pasted }, { onSuccess: () => (confirming.value = undefined) });
}

const BLOCKED: Record<string, string> = {
  installed_from_elsewhere: 'Installed from another repository',
  key_changed: 'Repository key changed',
};
</script>

<template>
  <div class="page">
    <PageHeader title="Plugins" subtitle="Plugins are installed from signed or unsigned repositories, or from a file">
      <button class="btn" type="button" @click="rescan">Rescan</button>
      <button class="btn btn-primary" type="button" @click="openFromFile">Install from file</button>
    </PageHeader>

    <nav class="tabs" role="tablist" aria-label="Plugin lists" @keydown="rovingKeydown">
      <button
        :id="tabId('installed')"
        type="button"
        role="tab"
        :aria-selected="tab === 'installed'"
        :aria-controls="tab === 'installed' ? `${uid}-panel` : undefined"
        :tabindex="tab === 'installed' ? 0 : -1"
        :class="{ active: tab === 'installed' }"
        @click="tab = 'installed'"
      >
        Installed ({{ plugins.length }})
      </button>
      <button
        :id="tabId('available')"
        type="button"
        role="tab"
        :aria-selected="tab === 'available'"
        :aria-controls="tab === 'available' ? `${uid}-panel` : undefined"
        :tabindex="tab === 'available' ? 0 : -1"
        :class="{ active: tab === 'available' }"
        @click="tab = 'available'"
      >
        Available ({{ available.length }})
      </button>
      <button
        :id="tabId('repos')"
        type="button"
        role="tab"
        :aria-selected="tab === 'repos'"
        :aria-controls="tab === 'repos' ? `${uid}-panel` : undefined"
        :tabindex="tab === 'repos' ? 0 : -1"
        :class="{ active: tab === 'repos' }"
        @click="tab = 'repos'"
      >
        Repositories ({{ repos.length }})
      </button>
    </nav>

    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert ok" role="status">{{ notice }}</p>

    <div
      v-if="tab === 'installed'"
      :id="`${uid}-panel`"
      class="table-card"
      role="tabpanel"
      :aria-labelledby="tabId('installed')"
    >
      <table class="table" :aria-labelledby="tabId('installed')" :aria-busy="loading">
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Version</th>
            <th>Signature</th>
            <th>Status</th>
            <th>Endpoints</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in plugins" :key="p.id">
            <td>
              <strong :id="`${uid}-p-${p.id}`">{{ p.manifest.name ?? p.pluginId }}</strong>
              <span class="mono small muted">{{ p.pluginId }}</span>
              <div v-if="p.manifest.description" class="small muted">{{ p.manifest.description }}</div>
              <div v-if="p.manifest.network?.hosts?.length" class="small muted">
                Declares network access to:
                <template
                  v-for="(h, n) in describeHosts(p.manifest.network.hosts, p.manifest.connection?.schema)"
                  :key="n"
                  >{{ n ? ', ' : '' }}<span v-if="h.literal" class="mono">{{ h.raw }}</span
                  ><template v-else
                    >{{ h.text }} (<span class="mono" data-raw-host>{{ h.raw }}</span
                    >)</template
                  ></template
                >
              </div>
            </td>
            <td class="mono">{{ p.version }}</td>
            <td>
              <template v-if="p.manual">
                <span
                  class="pill warn"
                  :title="`Uploaded ${formatDate(p.manual.uploadedAt)} · sha256 ${p.sha256 ?? ''}`"
                  >manual</span
                >
                <div class="small muted">
                  <span class="mono">{{ p.manual.fileName }}</span>
                  <div>
                    uploaded {{ ago(p.manual.uploadedAt) }} · <span class="mono">{{ shortSha(p.sha256) }}</span>
                  </div>
                </div>
                <button
                  v-if="p.manual?.releasedVersion"
                  class="btn btn-sm revert"
                  type="button"
                  :aria-describedby="`${uid}-p-${p.id}`"
                  @click="openRevert(p)"
                >
                  Revert to released {{ p.manual.releasedVersion }}…
                </button>
              </template>
              <span v-else-if="p.signatureVerified" class="pill ok">signed</span>
              <span v-else class="pill warn">unsigned</span>
            </td>
            <td>
              <span class="pill" :class="{ ok: p.status === 'ok', danger: p.status !== 'ok' }">{{ p.status }}</span>
              <div v-if="p.statusError" class="small err">{{ p.statusError }}</div>
            </td>
            <td>{{ p.instances }}</td>
            <td class="right">
              <button
                class="btn btn-sm"
                type="button"
                :disabled="p.status !== 'ok' && !p.enabled"
                :aria-describedby="`${uid}-p-${p.id}`"
                @click="toggle(p)"
              >
                {{ p.enabled ? 'Disable' : 'Enable' }}
              </button>
              <button
                class="btn btn-sm btn-danger"
                type="button"
                :disabled="p.instances > 0"
                :aria-describedby="`${uid}-p-${p.id}`"
                @click="uninstall(p)"
              >
                Uninstall
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="sr-only" role="status">Loading…</p>
    </div>

    <div
      v-else-if="tab === 'available'"
      :id="`${uid}-panel`"
      class="table-card"
      role="tabpanel"
      :aria-labelledby="tabId('available')"
    >
      <table class="table" :aria-labelledby="tabId('available')" :aria-busy="loading">
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Repository</th>
            <th>Latest</th>
            <th>Installed</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in available" :key="`${a.repoId}:${a.pluginId}`">
            <td>
              <strong :id="rowId(a)">{{ a.name }}</strong> <span class="mono small muted">{{ a.pluginId }}</span>
              <div v-if="a.description" class="small muted">{{ a.description }}</div>
            </td>
            <td>
              {{ a.repoName ?? '—' }}
              <span class="pill" :class="a.signingMode === 'signed' ? 'ok' : 'warn'">{{ a.signingMode }}</span>
            </td>
            <td class="mono">{{ a.latest ?? 'none compatible' }}</td>
            <td class="mono">
              {{ a.installed?.version ?? '—' }}
              <span v-if="a.installed?.manual" class="pill warn">manual</span>
              <span v-else-if="a.updateAvailable" class="pill info">update</span>
            </td>
            <td class="right">
              <span v-if="a.blocked" class="pill warn">{{ BLOCKED[a.blocked] ?? a.blocked }}</span>
              <button
                v-else
                class="btn btn-sm btn-primary"
                type="button"
                :disabled="!a.latest"
                :aria-describedby="rowId(a)"
                @click="openInstall(a)"
              >
                {{
                  !a.installed
                    ? 'Install…'
                    : a.installed.manual
                      ? `Revert / update to ${a.latest}…`
                      : !a.installed.managed
                        ? 'Replace…'
                        : a.updateAvailable
                          ? 'Update…'
                          : 'Reinstall…'
                }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!available.length" class="empty">Add a repository to see plugins you can install.</div>
    </div>

    <div v-else :id="`${uid}-panel`" class="stack" role="tabpanel" :aria-labelledby="tabId('repos')">
      <div class="row">
        <span class="grow" />
        <button class="btn btn-primary" type="button" @click="adding = { url: '', signingMode: 'signed', pasted: '' }">
          Add repository
        </button>
      </div>
      <div class="table-card">
        <table class="table" :aria-labelledby="tabId('repos')" :aria-busy="loading">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Signing</th>
              <th>Plugins</th>
              <th>Fetched</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in repos" :key="r.id">
              <td>
                <strong :id="`${uid}-r-${r.id}`">{{ r.name ?? r.url }}</strong>
                <div class="small mono muted">{{ r.url }}</div>
                <div v-if="r.lastFetchError" class="small err">{{ r.lastFetchError }}</div>
              </td>
              <td>
                <template v-if="r.signingMode === 'signed'">
                  <span v-if="r.keyStatus === 'ok'" class="pill ok">signed</span>
                  <span v-else class="pill danger">key changed</span>
                  <div class="small mono muted">{{ r.keyId }}</div>
                </template>
                <span v-else class="pill warn">unsigned</span>
              </td>
              <td>{{ r.pluginCount }}</td>
              <td class="small">{{ ago(r.lastFetchedAt) }}</td>
              <td class="right">
                <button
                  v-if="r.keyStatus === 'key_changed'"
                  class="btn btn-sm btn-danger"
                  type="button"
                  :aria-describedby="`${uid}-r-${r.id}`"
                  @click="openConfirm(r)"
                >
                  Review key…
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :aria-describedby="`${uid}-r-${r.id}`"
                  @click="act(refreshRepo, r.id, 'Refreshed.')"
                >
                  Refresh
                </button>
                <button
                  class="btn btn-sm btn-danger"
                  type="button"
                  :aria-describedby="`${uid}-r-${r.id}`"
                  @click="act(removeRepo, r.id, 'Repository removed.')"
                >
                  Remove
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!repos.length" class="empty">No repositories. Add one to install plugins.</div>
      </div>
    </div>

    <ModalDialog v-if="installing" :title="`Install ${installing.item.name}`" @close="installing = undefined">
      <div class="field">
        <label for="i-ver">Version</label>
        <select id="i-ver" v-model="installing.version">
          <option v-for="v in installing.item.versions" :key="v.version" :value="v.version" :disabled="!v.compatible">
            {{ v.version }}{{ v.compatible ? '' : ' (incompatible)' }}
          </option>
        </select>
      </div>
      <p class="small muted">
        Plugins run in their own process and can only read their own files, but they can reach the network.
      </p>
      <p v-if="installing.item.installed && !installing.item.installed.managed" class="alert warn">
        {{ installing.item.pluginId }} {{ installing.item.installed.version }} wasn't installed from a repository. This
        replaces its files and keeps its endpoints, but leaves the plugin disabled until you review and enable it.
      </p>
      <p v-if="installing.item.installed?.manual" class="alert warn">
        {{ installing.item.pluginId }} {{ installing.item.installed.version }} is an uploaded file. This installs the
        repository version in its place and keeps its endpoints.
      </p>
      <template v-if="installRepo?.signingMode === 'unsigned'">
        <p class="alert warn">
          This repository is unsigned: only the checksum in its index is verified, so whoever controls the index
          controls the code.
        </p>
        <TypedConfirm v-model="installing.confirm" :expected="installing.item.pluginId" action="install anyway" />
      </template>
      <p v-else class="small">
        The download is checked against the index checksum and the repository's pinned signing key.
      </p>
      <p v-if="installError" class="alert error" role="alert">{{ installError }}</p>
      <template #footer>
        <button class="btn" type="button" @click="installing = undefined">Cancel</button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="
            installBusy || (installRepo?.signingMode === 'unsigned' && installing.confirm !== installing.item.pluginId)
          "
          @click="install"
        >
          {{ installBusy ? 'Installing…' : 'Install' }}
        </button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="fromFile" title="Install plugin from file" @close="fromFile = undefined">
      <div class="field">
        <label for="f-file">Plugin file (.tgz)</label>
        <input id="f-file" type="file" accept=".tgz,.tar.gz,application/gzip" @change="pickFile" />
        <p class="help">A tarball as <code>synoikia-plugin repo pack</code> makes it, up to 50 MB.</p>
      </div>
      <p v-if="uploadPlugin.errorText.value" class="alert error" role="alert">{{ uploadPlugin.errorText.value }}</p>
      <template v-if="fromFile.staged">
        <dl class="summary">
          <dt>Plugin</dt>
          <dd class="mono">{{ fromFile.staged.pluginId }}</dd>
          <dt>Version</dt>
          <dd class="mono">{{ fromFile.staged.version }}</dd>
          <dt>sha256</dt>
          <dd class="mono" :title="fromFile.staged.sha256">{{ shortSha(fromFile.staged.sha256) }}</dd>
          <dt>Replaces</dt>
          <dd v-if="fromFile.staged.replaces">
            <span class="mono">{{ fromFile.staged.replaces.version }}</span>
            {{
              fromFile.staged.replaces.manual
                ? '(an uploaded file)'
                : fromFile.staged.replaces.repoName
                  ? `from ${fromFile.staged.replaces.repoName}`
                  : '(not from a repository)'
            }}. Its endpoints, connections and access levels stay.
          </dd>
          <dd v-else>Nothing: this is a new plugin. It starts disabled.</dd>
        </dl>
        <p v-if="!fromFile.staged.sdkCompatible" class="alert error" role="alert">
          This file needs plugin SDK <span class="mono">{{ fromFile.staged.sdk }}</span
          >, which this Synoikia doesn't support.
        </p>
        <div v-if="fromFile.staged.permissionChanges.length" class="alert warn">
          This file changes what the plugin may do:
          <ul>
            <li v-for="c in fromFile.staged.permissionChanges" :key="c" class="mono">{{ c }}</li>
          </ul>
          The plugin is disabled after the install. Review it, then Enable it on the Installed tab.
        </div>
        <p class="alert warn">
          This file is unsigned. Only your review vouches for its code.
          <template v-if="fromFile.staged.replaces?.enabled && !fromFile.staged.permissionChanges.length">
            {{ fromFile.staged.pluginId }} stays enabled, and its live endpoints serve this code at once.
          </template>
        </p>
        <TypedConfirm v-model="fromFile.confirm" :expected="fromFile.staged.pluginId" action="install it" />
      </template>
      <p v-if="installUpload.errorText.value" class="alert error" role="alert">{{ installUpload.errorText.value }}</p>
      <template #footer>
        <button class="btn" type="button" @click="fromFile = undefined">Cancel</button>
        <button
          v-if="!fromFile.staged"
          class="btn btn-primary"
          type="button"
          :disabled="!fromFile.file || uploadPlugin.isPending.value"
          @click="upload"
        >
          {{ uploadPlugin.isPending.value ? 'Uploading…' : 'Upload' }}
        </button>
        <button
          v-else
          class="btn btn-primary"
          type="button"
          :disabled="
            installUpload.isPending.value ||
            !fromFile.staged.sdkCompatible ||
            fromFile.confirm !== fromFile.staged.pluginId
          "
          @click="installFromFile"
        >
          {{ installUpload.isPending.value ? 'Installing…' : 'Install' }}
        </button>
      </template>
    </ModalDialog>

    <ModalDialog
      v-if="reverting?.plugin.manual?.releasedVersion"
      :title="`Revert ${reverting.plugin.pluginId} to ${reverting.plugin.manual.releasedVersion}`"
      @close="reverting = undefined"
    >
      <p>
        This installs {{ reverting.plugin.pluginId }}
        <span class="mono">{{ reverting.plugin.manual.releasedVersion }}</span> from
        {{ reverting.repo?.name ?? reverting.repo?.url ?? 'its repository' }} in place of the uploaded file
        <span class="mono">{{ reverting.plugin.manual.fileName }}</span
        >. Its endpoints, connections and access levels stay.
      </p>
      <p class="small muted">
        If the released version changes what the plugin may do, the plugin is disabled until you enable it again.
      </p>
      <template v-if="reverting.repo?.signingMode === 'unsigned'">
        <p class="alert warn">
          This repository is unsigned: only the checksum in its index is verified, so whoever controls the index
          controls the code.
        </p>
        <TypedConfirm v-model="reverting.confirm" :expected="reverting.plugin.pluginId" action="revert anyway" />
      </template>
      <p v-if="revertPlugin.errorText.value" class="alert error" role="alert">{{ revertPlugin.errorText.value }}</p>
      <template #footer>
        <button class="btn" type="button" @click="reverting = undefined">Cancel</button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="
            revertPlugin.isPending.value ||
            (reverting.repo?.signingMode === 'unsigned' && reverting.confirm !== reverting.plugin.pluginId)
          "
          @click="revert"
        >
          {{ revertPlugin.isPending.value ? 'Reverting…' : 'Revert' }}
        </button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="adding" title="Add plugin repository" @close="adding = undefined">
      <div class="field">
        <label for="r-url">Index URL</label>
        <input
          id="r-url"
          v-model="adding.url"
          placeholder="https://example.com/mcp-plugins/index.json"
          :disabled="!!adding.offered"
        />
      </div>
      <div class="field">
        <label for="r-mode">Signing</label>
        <select id="r-mode" v-model="adding.signingMode" :disabled="!!adding.offered">
          <option value="signed">Signed — verify every download against a pinned minisign key</option>
          <option value="unsigned">Unsigned — checksum only, typed confirmation on every install</option>
        </select>
      </div>
      <template v-if="adding.offered">
        <p class="small">
          The repository publishes this key (id <span class="mono">{{ adding.offered.keyId }}</span
          >):
        </p>
        <pre class="code">{{ adding.offered.publicKey }}</pre>
        <p class="small">
          Check it against the key the publisher advertises somewhere you trust (their website or README), then paste
          <strong>their</strong> copy below. Don't copy it from this page.
        </p>
        <div class="field">
          <label for="r-key">Publisher's public key</label>
          <textarea id="r-key" v-model="adding.pasted" rows="3" placeholder="RW…" />
        </div>
      </template>
      <p v-if="adding.note" class="alert error" role="alert">{{ adding.note }}</p>
      <template #footer>
        <button class="btn" type="button" @click="adding = undefined">Cancel</button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="!adding.url.trim() || (!!adding.offered && !adding.pasted.trim())"
          @click="addRepo"
        >
          {{ adding.signingMode === 'signed' && !adding.offered ? 'Fetch key' : 'Add repository' }}
        </button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="confirming" title="Repository key changed" @close="confirming = undefined">
      <p class="alert warn">
        {{ confirming.repo.name ?? confirming.repo.url }} now publishes a different signing key. Installs and updates
        from it are blocked until you confirm the new key with the publisher. A key change you didn't expect can mean
        the repository was compromised.
      </p>
      <p class="small">
        Pinned: <span class="mono">{{ confirming.repo.keyId }}</span>
      </p>
      <template v-if="confirming.repo.offeredKey">
        <p class="small">
          Offered (id <span class="mono">{{ confirming.repo.offeredKey.keyId }}</span
          >):
        </p>
        <pre class="code">{{ confirming.repo.offeredKey.publicKey }}</pre>
      </template>
      <div class="field">
        <label for="c-key">Publisher's new public key</label>
        <textarea id="c-key" v-model="confirming.pasted" rows="3" placeholder="RW…" />
      </div>
      <p v-if="confirmError" class="alert error" role="alert">{{ confirmError }}</p>
      <template #footer>
        <button class="btn" type="button" @click="confirming = undefined">Cancel</button>
        <button class="btn btn-danger-solid" type="button" :disabled="!confirming.pasted.trim()" @click="confirmKey">
          Trust new key
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 16px 0;
}
.summary dt {
  color: var(--ink-muted);
}
.summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.revert {
  margin-top: 8px;
  white-space: nowrap;
}
.alert ul {
  margin: 6px 0;
  padding-left: 20px;
}
strong + .mono {
  margin-left: 6px;
}
.err {
  color: var(--danger-text);
}
.right {
  text-align: right;
  white-space: nowrap;
}
.right > * + * {
  margin-left: 6px;
}
</style>
