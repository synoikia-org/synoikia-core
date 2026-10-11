<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useCopy } from '../composables/useCopy';
import { AUTH_METHOD_LABELS } from '../format';
import type { AuthMethod, Instance } from '../types';

/** How to point an MCP client at this endpoint: instructions only, tokens shown as `<token>`. */
const props = defineProps<{
  instance: Instance;
  /** Whether MCP clients may register themselves (OAuth dynamic client registration); null if unknown. */
  dynamicRegistration: boolean | null;
}>();

const CLIENTS = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  cloudflare: 'Cloudflare MCP portal',
} as const;
type Client = keyof typeof CLIENTS;

const STORAGE_KEY = 'synoikia.connectClient';
function remembered(): Client {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in CLIENTS) return v as Client;
  } catch {
    // storage blocked: fall back to the default
  }
  return 'claude-code';
}
const client = ref<Client>(remembered());
watch(client, (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // not remembered; harmless
  }
});

const slug = computed(() => props.instance.slug);
/** Without PUBLIC_MCP_URL only the path is known and the MCP port differs from this portal's,
 * so a placeholder host is shown rather than a guess. */
const knownUrl = computed(() => {
  const u = props.instance.endpointUrl;
  return u && /^https?:\/\//.test(u) ? u : null;
});
const url = computed(() => knownUrl.value ?? `https://<your-mcp-host>/${props.instance.slug}`);
/** The endpoint's accepted methods, browser sign-ins first: the order the method picker offers them in. */
const methods = computed(() =>
  (['oauth', 'external', 'bearer'] as const).filter((m) =>
    (props.instance.effectiveAuthMethods ?? ['oauth']).includes(m),
  ),
);
const picked = ref<AuthMethod>();
const auth = computed({
  get: (): AuthMethod | undefined =>
    picked.value && methods.value.includes(picked.value) ? picked.value : methods.value[0],
  set: (m) => (picked.value = m),
});
const oauth = computed(() => auth.value === 'oauth');
const bearer = computed(() => auth.value === 'bearer');
const external = computed(() => auth.value === 'external');

const codeCommand = computed(() => {
  // One argument per line, so it reads well in the narrow column and still pastes as one command.
  const lines = ['claude mcp add', '--transport http', slug.value, url.value];
  if (bearer.value) lines.push('--header "Authorization: Bearer <token>"');
  return lines.join(' \\\n');
});

// mcp-remote takes "Name:value" headers; the bearer token goes through an env var so it isn't split.
const desktopConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        [slug.value]: {
          command: 'npx',
          args: ['-y', 'mcp-remote@latest', url.value, '--header', 'Authorization:${AUTH}'],
          env: { AUTH: 'Bearer <token>' },
        },
      },
    },
    null,
    2,
  ),
);

const { copied, copy } = useCopy();
</script>

<template>
  <div class="card connect">
    <h2>Connect a client</h2>
    <select v-model="client" class="select" aria-label="Client to set up">
      <option v-for="(label, key) in CLIENTS" :key="key" :value="key">{{ label }}</option>
    </select>
    <div class="snippet">
      <div class="snippet-head">
        <span id="connect-url-label" class="label">Endpoint URL</span>
        <button class="btn btn-sm copy" type="button" aria-describedby="connect-url-label" @click="copy(url)">
          {{ copied === url ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <pre class="code" data-snippet="url">{{ url }}</pre>
    </div>
    <p v-if="!knownUrl" class="alert warn" data-warn="public-url">
      Synoikia doesn't know its public MCP address. Set <code>PUBLIC_MCP_URL</code> to the address clients reach the MCP
      port on, then replace <code>&lt;your-mcp-host&gt;</code> below.
    </p>
    <div class="meta">
      Sign-in
      <template v-if="methods.length">
        <span v-for="m in methods" :key="m" class="pill">{{ AUTH_METHOD_LABELS[m] }}</span>
      </template>
      <span v-else class="pill danger">none</span>
      <RouterLink :to="`/endpoints/${slug}/settings`">change</RouterLink>
    </div>
    <p v-if="!auth" class="alert warn" data-warn="no-auth-method">
      This endpoint accepts no client auth method, so it refuses every call. Enable a method under
      <RouterLink to="/settings/client-auth">Settings → Client auth</RouterLink>, or accept more on the endpoint's
      <RouterLink :to="`/endpoints/${slug}/settings`">Settings</RouterLink> tab.
    </p>
    <div v-else-if="methods.length > 1" class="field method">
      <label for="connect-method">Sign in with</label>
      <select id="connect-method" v-model="auth">
        <option v-for="m in methods" :key="m" :value="m">{{ AUTH_METHOD_LABELS[m] }}</option>
      </select>
    </div>

    <template v-if="auth">
      <!-- Claude Code -->
      <ol v-if="client === 'claude-code'" class="steps">
        <li v-if="bearer">
          Create a token under <RouterLink to="/clients">Clients &amp; Tokens</RouterLink> with access to
          <code>/{{ slug }}</code
          >.
        </li>
        <li>
          <template v-if="bearer">Add the server with it:</template>
          <template v-else>Add the server:</template>
          <div class="snippet">
            <div class="snippet-head">
              <button class="btn btn-sm copy" type="button" aria-label="Copy command" @click="copy(codeCommand)">
                {{ copied === codeCommand ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <pre class="code" data-snippet="command">{{ codeCommand }}</pre>
          </div>
          <p class="small muted note">Add <code>--scope user</code> to use it in every project.</p>
        </li>
        <li v-if="oauth">
          In Claude Code, run <code>/mcp</code>, pick <strong>{{ slug }}</strong> and choose
          <strong>Authenticate</strong>. Sign in to Synoikia in the browser and choose <strong>Read only</strong> or
          <strong>Read &amp; write</strong>.
        </li>
        <li v-else-if="external">
          In Claude Code, run <code>/mcp</code>, pick <strong>{{ slug }}</strong> and choose
          <strong>Authenticate</strong>. Sign in with Cloudflare Access in the browser.
        </li>
        <li v-else>
          Run <code>/mcp</code> in Claude Code to check that <strong>{{ slug }}</strong> is connected.
        </li>
        <li>Calls that need approval open Synoikia's approval page in your browser.</li>
      </ol>

      <!-- Claude Desktop -->
      <ol v-else-if="client === 'claude-desktop'" class="steps">
        <template v-if="!bearer">
          <li>
            In Claude Desktop, open <strong>Settings → Connectors</strong> and choose
            <strong>Add custom connector</strong>.
          </li>
          <li>
            Name it <strong>{{ instance.displayName || slug }}</strong> and paste the endpoint URL above as the server
            URL.
          </li>
          <li v-if="external">
            Choose <strong>Add</strong>, then <strong>Connect</strong>, and sign in with Cloudflare Access.
          </li>
          <li v-else>
            Choose <strong>Add</strong>, then <strong>Connect</strong>. Sign in to Synoikia and choose
            <strong>Read only</strong> or <strong>Read &amp; write</strong>.
          </li>
          <li>Turn it on in a chat from the tools menu. The connector also appears on claude.ai.</li>
        </template>
        <template v-else>
          <li>
            Create a token under <RouterLink to="/clients">Clients &amp; Tokens</RouterLink> with access to
            <code>/{{ slug }}</code
            >.
          </li>
          <li>
            Custom connectors in Claude Desktop only sign in with OAuth, so use the config file instead:
            <strong>Settings → Developer → Edit Config</strong>, and add to <code>claude_desktop_config.json</code>:
            <div class="snippet">
              <div class="snippet-head">
                <button class="btn btn-sm copy" type="button" aria-label="Copy config" @click="copy(desktopConfig)">
                  {{ copied === desktopConfig ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre class="code scroll" data-snippet="config">{{ desktopConfig }}</pre>
            </div>
            <p class="small muted note">Needs Node.js. Keep the token out of shared files.</p>
          </li>
          <li>
            Restart Claude Desktop. <strong>{{ slug }}</strong> shows in the tools menu.
          </li>
        </template>
      </ol>

      <!-- Cloudflare MCP portal -->
      <template v-else>
        <p v-if="bearer" class="alert warn" data-warn="auth">
          Cloudflare MCP portals sign in to servers with OAuth. Let this endpoint accept <strong>OAuth</strong> or
          <strong>External</strong> with Cloudflare Access on its
          <RouterLink :to="`/endpoints/${slug}/settings`">Settings</RouterLink> tab first.
        </p>
        <p v-if="external" class="small muted note" data-note="cf-access">
          With External, Cloudflare Access signs clients in. Set up the Access application with
          <strong>Managed OAuth</strong> first, as described under
          <RouterLink to="/settings/client-auth">Settings → Client auth</RouterLink>; the portal then signs in through
          Access.
        </p>
        <p v-if="oauth && dynamicRegistration === false" class="alert warn" data-warn="dcr">
          The portal's <strong>Automatic</strong> OAuth option registers itself with Synoikia. Turn on
          <strong>Let MCP clients register themselves</strong> under
          <RouterLink to="/settings/client-auth">Settings → Client auth</RouterLink>.
        </p>
        <ol class="steps">
          <li>
            In the Cloudflare dashboard, go to <strong>Zero Trust → Access controls → MCP Portals</strong>, open the
            <strong>MCP servers</strong> tab and choose <strong>Add MCP server</strong>.
          </li>
          <li>
            Name it <strong>{{ slug }}</strong> and paste the endpoint URL above into <strong>HTTP URL</strong>. Add
            Access policies for who may see it.
          </li>
          <li>
            Under <strong>OAuth credentials</strong>, choose <strong>Automatic (recommended)</strong>, then
            <strong>Save and connect server</strong>.
          </li>
          <li>
            <template v-if="external">Sign in with Cloudflare Access when asked.</template>
            <template v-else>
              Sign in to Synoikia when asked and choose <strong>Read &amp; write</strong> if the portal should reach
              writes.
            </template>
            This sign-in becomes the server's admin credential.
          </li>
          <li>
            When the server shows <strong>Ready</strong>, add it to a portal. Clients then connect to
            <code>https://&lt;portal-domain&gt;/mcp</code>.
          </li>
        </ol>
        <p class="small muted note">
          Calls that need approval still go to Synoikia's approval page. A client that can't show it through the portal
          gets them refused; reads and pre-approved writes still work.
        </p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.select {
  width: 100%;
}
.label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  color: var(--ink-muted);
}
.connect > .snippet {
  margin-top: 14px;
}
.snippet-head {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 4px;
}
.snippet-head .label {
  margin: 0 auto 0 0;
}
.snippet pre.code {
  padding: 10px 12px;
  overflow-wrap: anywhere;
  word-break: normal;
}
/* JSON keeps its shape and scrolls sideways rather than breaking mid-word. */
.snippet pre.code.scroll {
  white-space: pre;
  overflow-x: auto;
  overflow-wrap: normal;
}
.method {
  margin: 12px 0 0;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--ink-muted);
}
.steps {
  margin: 14px 0 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 19px;
}
.steps > li {
  margin-bottom: 10px;
}
.steps .snippet {
  margin-top: 6px;
}
.alert {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 19px;
}
.note {
  margin: 8px 0 0;
}
</style>
