<script setup lang="ts">
import { messageRole } from '../../a11y';
import { computed, ref, toRaw, useId, watch } from 'vue';
import { errorText } from '../../api';
import ChipsInput from '../../components/ChipsInput.vue';
import { useCopy } from '../../composables/useCopy';
import { useClientsSeenQuery, useSaveSettings, useSettingsQuery } from '../../composables/useSettings';
import { AUTH_METHOD_LABELS, EXTERNAL_PROVIDER_LABELS, ago } from '../../format';
import { AUTH_METHODS } from '../../types';
import type { AuthMethod, ClientPolicyMode, ExternalProvider, Settings } from '../../types';

const settingsQuery = useSettingsQuery();
const saveMcp = useSaveSettings('mcp');
const saving = saveMcp.isPending;
const form = ref<Settings['mcp']>();
const uid = useId();
const publicMcpUrl = computed(() => settingsQuery.data.value?.publicMcpUrl ?? null);
const saved = ref<{ kind: 'ok' | 'error'; text: string }>();
const message = computed(() => {
  const loadError = settingsQuery.error.value;
  return saved.value ?? (loadError && !form.value ? { kind: 'error', text: errorText(loadError) } : undefined);
});
const endpointPattern = computed(() => `${publicMcpUrl.value ?? '<this server>'}/<slug>`);

// The form is a draft: it follows the cached section, which a save replaces with core's answer.
watch(
  () => settingsQuery.data.value?.mcp,
  (mcp) => {
    if (mcp) form.value = structuredClone(toRaw(mcp));
  },
  { immediate: true },
);

const noMethod = computed(() => !!form.value && !AUTH_METHODS.some((m) => form.value?.clientAuth[m]));
const noAllowedClient = computed(
  () => form.value?.clientPolicy.mode === 'allow' && !form.value.clientPolicy.names.length,
);

const clientsSeen = useClientsSeenQuery();
const listed = (name: string) => !!form.value?.clientPolicy.names.some((n) => n.toLowerCase() === name.toLowerCase());
const unlistedSeen = computed(() => (clientsSeen.data.value ?? []).filter((c) => !listed(c.name)));
const seenSuggestions = computed(() =>
  unlistedSeen.value.map((c) => ({ value: c.name, label: c.version ? `${c.name} ${c.version}` : c.name })),
);
function addClient(name: string) {
  if (form.value && !listed(name)) form.value.clientPolicy.names.push(name);
}
const POLICY_MODES: { value: ClientPolicyMode; label: string }[] = [
  { value: 'off', label: 'Off: every client can connect' },
  { value: 'allow', label: 'Allow only these clients' },
  { value: 'deny', label: 'Deny these clients' },
];

function save() {
  saved.value = undefined;
  saveMcp.mutate(form.value, {
    onSuccess: () => (saved.value = { kind: 'ok', text: 'Saved.' }),
    onError: (err) => (saved.value = { kind: 'error', text: errorText(err) }),
  });
}

/** Redirect URIs to allow on the Cloudflare Access application's Managed OAuth, per client. */
const CF_REDIRECTS = [
  {
    client: 'Claude (claude.ai and Claude Desktop connectors)',
    uris: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'],
  },
  {
    client: 'Cloudflare MCP portal (only if you use step 5)',
    uris: [
      'https://dash.cloudflare.com/*',
      'https://<portal-hostname>/servers-callback',
      'https://oauth-callbacks.cloudflareaccess.com/cdn-cgi/access/outbound-oauth-callback',
    ],
  },
];

const { copied, copy } = useCopy();

const METHOD_HELP: Record<AuthMethod, string> = {
  bearer: "Clients send a token created under Clients & Tokens or on a user's profile.",
  oauth:
    'Clients sign in through this server with a portal account (OAuth 2.1 with PKCE). This is what claude.ai connectors expect.',
  external:
    'An identity provider in front of the MCP port signs clients in. Synoikia checks its signed assertion on each request.',
};
const PROVIDERS = Object.keys(EXTERNAL_PROVIDER_LABELS) as ExternalProvider[];
</script>

<template>
  <form v-if="form" class="stack" @submit.prevent="save">
    <section class="card about">
      <h2>How MCP access works</h2>
      <ul class="small">
        <li>
          Each endpoint is its own MCP server at
          <span class="mono">{{ endpointPattern }}</span
          >. Add it to an MCP client from the endpoint's Connection tab.
        </li>
        <li>
          An endpoint exposes two tools: <code>search</code> to explore the service's API and <code>execute</code> to
          call it. Every call goes through the endpoint's Access levels, pre-approval rules, approvals and the audit
          log.
        </li>
        <li>
          Client auth only decides <em>who can connect</em>, not what a client may do. Every endpoint accepts all the
          methods enabled below, unless its own Settings tab limits it to some of them.
        </li>
        <li>
          Bearer tokens are created under <RouterLink to="/clients">Clients &amp; Tokens</RouterLink>. OAuth lets a
          client sign in through this server with a portal account. External leaves sign-in to an identity provider in
          front of the server, and each call runs as the matching portal user.
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>Client auth methods</h2>
      <p id="m-methods-help" class="small muted">
        Every endpoint accepts all enabled methods, unless the endpoint is limited to some of them in its own settings.
      </p>
      <fieldset class="methods" aria-describedby="m-methods-help">
        <legend class="sr-only">Enabled client auth methods</legend>
        <div v-for="m in AUTH_METHODS" :key="m" class="field check">
          <label
            ><input v-model="form.clientAuth[m]" type="checkbox" :aria-describedby="`m-${m}-help`" />
            {{ AUTH_METHOD_LABELS[m] }}</label
          >
          <p :id="`m-${m}-help`" class="help">{{ METHOD_HELP[m] }}</p>
        </div>
      </fieldset>
      <p v-if="noMethod" class="alert warn" data-warn="no-method">
        Enable at least one method. Without one, no MCP client can connect.
      </p>
      <template v-if="form.clientAuth.external">
        <div class="field provider">
          <label for="m-provider">External provider</label>
          <select id="m-provider" v-model="form.external.provider">
            <option v-for="p in PROVIDERS" :key="p" :value="p">{{ EXTERNAL_PROVIDER_LABELS[p] }}</option>
          </select>
        </div>
        <p class="alert warn" role="note" data-warn="external-approvals">
          With external client auth, users approve their own calls on the approval page with the same provider identity.
          A client that holds the user's identity could open the approval link itself. Approvals then protect against
          agent mistakes, not against a hostile client.
        </p>
      </template>
      <p class="small">
        Public MCP URL: <span class="mono">{{ publicMcpUrl ?? 'not set — derived from each request' }}</span>
      </p>
    </section>

    <section class="card" data-card="clients">
      <h2>Clients</h2>
      <p id="m-clients-help" class="small muted">
        Allow or deny MCP clients by the name they send when they connect, for example <code>claude-code</code>. Upper
        and lower case do not matter. A change also ends open sessions of a client it refuses.
      </p>
      <p class="alert warn" role="note" data-warn="client-names">
        Clients declare their own names. The list stops honest clients that you do not want used, but it is not a
        security boundary: any client can send any name. Client auth and the endpoint's access levels are the boundary.
      </p>
      <fieldset class="methods" aria-describedby="m-clients-help">
        <legend class="sr-only">Client policy</legend>
        <label v-for="m in POLICY_MODES" :key="m.value" class="row small"
          ><input v-model="form.clientPolicy.mode" type="radio" name="m-client-mode" :value="m.value" />
          {{ m.label }}</label
        >
      </fieldset>
      <template v-if="form.clientPolicy.mode !== 'off'">
        <div class="field">
          <label for="m-names">Client names</label>
          <ChipsInput
            v-model="form.clientPolicy.names"
            input-id="m-names"
            placeholder="Type a client name and press Enter"
            :suggestions="seenSuggestions"
            aria-describedby="m-names-help"
          />
          <p id="m-names-help" class="help">Up to 50 names.</p>
        </div>
        <p v-if="noAllowedClient" class="alert warn" data-warn="no-client">
          Add at least one client. An empty allow list refuses every client.
        </p>
      </template>
      <div class="seen">
        <h3>Seen since the server started</h3>
        <p v-if="clientsSeen.error.value" class="alert error" role="alert">{{ errorText(clientsSeen.error.value) }}</p>
        <p v-else-if="clientsSeen.isPending.value" class="small muted" role="status">Loading…</p>
        <p v-else-if="!clientsSeen.data.value?.length" class="small muted">No client has connected yet.</p>
        <ul v-else class="small seen-list">
          <li v-for="c in clientsSeen.data.value" :key="c.name">
            <span class="mono">{{ c.name }}</span>
            <span class="muted">{{ [c.version, ago(c.lastSeen)].filter(Boolean).join(' · ') }}</span>
            <button
              v-if="form.clientPolicy.mode !== 'off' && !listed(c.name)"
              class="btn btn-sm"
              type="button"
              :aria-label="`Add ${c.name}`"
              @click="addClient(c.name)"
            >
              Add
            </button>
          </li>
        </ul>
      </div>
    </section>

    <section v-if="form.clientAuth.oauth" class="card">
      <h2>OAuth</h2>
      <p v-if="!publicMcpUrl" class="alert warn" data-warn="oauth-public-url">
        OAuth is off until <code>PUBLIC_MCP_URL</code> is set on the server to the address clients reach the MCP port
        on.
      </p>
      <ul class="small explain" data-explain="oauth">
        <li>
          Synoikia is the OAuth server itself, so there is no provider, client ID or secret to enter here. MCP clients
          find it from the endpoint URL.
        </li>
        <li>
          On first connect the client registers itself (if allowed below) and opens a browser. A portal account signs in
          (password and TOTP, or single sign-on), then picks which endpoints the client may use and whether it gets
          <strong>Read only</strong> or <strong>Read &amp; write</strong>.
        </li>
        <li>
          The client then gets a short-lived access token and a refresh token that changes on every use. Sign-ins always
          use PKCE.
        </li>
        <li>
          Registered clients and what each was granted are listed, and can be revoked, under
          <RouterLink to="/clients">Clients &amp; Tokens</RouterLink>.
        </li>
      </ul>
      <div class="field check">
        <label
          ><input v-model="form.allowDynamicRegistration" type="checkbox" aria-describedby="m-dcr-help" /> Let MCP
          clients register themselves (dynamic client registration)</label
        >
        <p id="m-dcr-help" class="help">When off, register each client by hand under Clients &amp; Tokens.</p>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="m-at">Access token lifetime (minutes)</label>
          <input id="m-at" v-model.number="form.accessTokenTtlMinutes" type="number" min="5" max="1440" />
        </div>
        <div class="field">
          <label for="m-rt">Refresh token lifetime (days)</label>
          <input id="m-rt" v-model.number="form.refreshTokenTtlDays" type="number" min="1" max="365" />
        </div>
      </div>
    </section>

    <section v-if="form.clientAuth.external && form.external.provider === 'cloudflare'" class="card">
      <h2>Cloudflare Access</h2>
      <p class="small muted">
        Every MCP request without a bearer token must carry a valid Cloudflare Access token
        (<code>Cf-Access-Jwt-Assertion</code>), which Synoikia checks itself. The token's e-mail address names the
        portal user; a user with that name signs in, or self-registration creates one. Service tokens are refused.
      </p>
      <div class="form-grid">
        <div class="field">
          <label for="m-cft">Cloudflare team domain</label>
          <input
            id="m-cft"
            v-model="form.cfAccess.teamDomain"
            placeholder="myteam.cloudflareaccess.com"
            aria-describedby="m-cft-help"
          />
          <p id="m-cft-help" class="help">Zero Trust → Settings → Team name and domain.</p>
        </div>
        <div class="field">
          <label for="m-cfa">Application audience (AUD)</label>
          <input id="m-cfa" v-model="form.cfAccess.aud" aria-describedby="m-cfa-help" />
          <p id="m-cfa-help" class="help">The Access application's Application Audience (AUD) Tag, on its Overview.</p>
        </div>
      </div>
      <h3>Set up Cloudflare</h3>
      <ol class="small steps" data-explain="cf-access">
        <li>
          Publish the MCP port through Cloudflare (a Tunnel public hostname or a proxied DNS record), for example
          <span class="mono">mcp.example.com</span>, and set <code>PUBLIC_MCP_URL</code> to it.
        </li>
        <li>
          In the Cloudflare dashboard go to <strong>Zero Trust → Access controls → Applications</strong>, choose
          <strong>Add an application → Self-hosted</strong>, and add that hostname. Add Allow policies for who may
          connect.
        </li>
        <li>
          In the application's <strong>Advanced settings</strong>, turn on <strong>Managed OAuth</strong> so MCP clients
          can sign in through Access. Under <strong>Allowed redirect URIs</strong>, add the callbacks of the clients you
          will use:
          <div v-for="r in CF_REDIRECTS" :key="r.client" class="redirects">
            <span class="label">{{ r.client }}</span>
            <div v-for="u in r.uris" :key="u" class="redirect">
              <pre :id="`${uid}-${u}`" class="code">{{ u }}</pre>
              <button class="btn btn-sm" type="button" :aria-describedby="`${uid}-${u}`" @click="copy(u)">
                {{ copied === u ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>
          <p class="note">
            For Claude Code and other local clients, turn on <strong>Allow localhost clients</strong> instead.
          </p>
        </li>
        <li>
          Copy the team domain and the application's AUD tag into the fields above and save. Every endpoint then accepts
          <strong>{{ AUTH_METHOD_LABELS.external }}</strong> unless its own settings leave it out.
        </li>
        <li>
          <span class="pill">Optional</span> <strong>MCP portal</strong>, to offer several endpoints from one address.
          Skip it to connect clients straight to the endpoint URL. Go to
          <strong>Zero Trust → Access controls → AI controls → MCP servers</strong>, choose
          <strong>Add MCP server</strong>, paste the endpoint URL (<span class="mono">{{ endpointPattern }}</span
          >), and under <strong>OAuth credentials</strong> choose <strong>Automatic</strong>. Sign in with Access when
          asked. Once the server shows <strong>Ready</strong>, add it to a portal; clients then connect to
          <span class="mono">https://&lt;portal-hostname&gt;/mcp</span>.
        </li>
      </ol>
    </section>

    <p v-if="message" class="alert" :class="message.kind" :role="messageRole(message.kind)">{{ message.text }}</p>
    <div class="actions">
      <button class="btn btn-primary" type="submit" :disabled="noMethod || noAllowedClient || saving">Save</button>
    </div>
  </form>
  <p v-else-if="message" class="alert error" role="alert">{{ message.text }}</p>
</template>

<style scoped>
.about ul {
  margin: 0;
  padding-left: 18px;
}
.about li + li,
.explain li + li,
.steps > li + li {
  margin-top: 6px;
}
.explain,
.steps {
  margin: 10px 0 14px;
  padding-left: 18px;
}
h3 {
  margin: 16px 0 0;
  font-size: 14px;
}
.redirects {
  margin-top: 8px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
}
.redirect {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.redirect pre.code {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 6px 10px;
  overflow-wrap: anywhere;
}
.note {
  margin: 8px 0 0;
}
.methods {
  border: none;
  padding: 0;
  margin: 8px 0 0;
}
.provider {
  max-width: 320px;
}
.seen-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.seen-list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seen-list li + li {
  margin-top: 4px;
}
</style>
