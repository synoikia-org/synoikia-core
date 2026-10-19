<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { errorText } from '../../api';
import { latestError } from '../../composables/useApiMutation';
import InfoTip from '../../components/InfoTip.vue';
import { useConfirm } from '../../composables/useConfirm';
import { useOverviewQuery } from '../../composables/useOverview';
import {
  useCreateRole,
  useDeleteRole,
  useRolesQuery,
  useSetRoleEndpointSwitches,
  useSetRoleInstances,
  useUpdateRole,
} from '../../composables/useRoles';
import type { EndpointSwitches, RoleRow } from '../../types';

/** Roles (design §6.4): Admin is built in; each other role has endpoints, three switches on each, maximum
 * levels (set on an endpoint's Access page) and the role-wide "See other endpoints". */
const overviewQuery = useOverviewQuery();
const rolesQuery = useRolesQuery();
const createRole = useCreateRole();
const update = useUpdateRole();
const del = useDeleteRole();
const setInstances = useSetRoleInstances();
const setSwitches = useSetRoleEndpointSwitches();
const { confirm, prompt } = useConfirm();
const instances = computed(() => overviewQuery.data.value?.instances ?? []);
const roles = computed(() => rolesQuery.data.value ?? []);
const newName = ref('');
const uid = useId();

// One page alert: the latest action's failure, else a failed load.
const error = computed(() => {
  const loadError = rolesQuery.error.value ?? overviewQuery.error.value;
  return (
    latestError([createRole, update, del, setInstances, setSwitches]) ?? (loadError ? errorText(loadError) : undefined)
  );
});

const ENDPOINT_SWITCHES: { key: keyof EndpointSwitches; label: string; help: string }[] = [
  {
    key: 'canSetOwnLevels',
    label: 'Set personal levels',
    help: 'Users set personal levels for their own calls on this endpoint, up to the role maximum.',
  },
  {
    key: 'canManageOwnRules',
    label: 'Own pre-approval rules',
    help: 'Users add pre-approval rules on this endpoint that apply only to their own calls.',
  },
  {
    key: 'canSeeStatus',
    label: 'See endpoint status',
    help: 'Users see the health, plugin and sync state of this endpoint, and every operation, also those at None.',
  },
];

const custom = computed(() => roles.value.filter((r) => !r.isAdmin));

const create = () => createRole.mutate(newName.value.trim(), { onSuccess: () => (newName.value = '') });
const flipOther = (r: RoleRow) => update.mutate({ id: r.id, canSeeOtherEndpoints: !r.canSeeOtherEndpoints });
const endpointOf = (r: RoleRow, instanceId: string) => r.endpoints.find((e) => e.instanceId === instanceId);
const flipSwitch = (r: RoleRow, instanceId: string, key: keyof EndpointSwitches) =>
  setSwitches.mutate({ id: r.id, instanceId, [key]: !endpointOf(r, instanceId)?.[key] });
const rename = async (r: RoleRow) => {
  const name = (
    await prompt({ title: `Rename ${r.name}`, label: 'New name', initial: r.name, action: 'Rename' })
  )?.trim();
  if (name && name !== r.name) update.mutate({ id: r.id, name });
};
const remove = async (r: RoleRow) => {
  if (await confirm({ title: `Delete the role ${r.name}?`, action: 'Delete', danger: true })) del.mutate(r.id);
};
const toggleEndpoint = async (r: RoleRow, i: { id: string; slug: string }, box: HTMLInputElement) => {
  const ids = r.endpoints.map((e) => e.instanceId);
  if (!ids.includes(i.id)) return setInstances.mutate({ id: r.id, instanceIds: [...ids, i.id] });
  const removing = await confirm({
    title: `Remove /${i.slug} from ${r.name}?`,
    message: `${r.name} loses its maximum levels on /${i.slug}. Its users lose their personal levels and own rules there.`,
    action: 'Remove',
    danger: true,
  });
  if (removing) setInstances.mutate({ id: r.id, instanceIds: ids.filter((x) => x !== i.id) });
  else box.checked = true;
};
</script>

<template>
  <div class="stack">
    <p class="small muted">
      Admins do all administration and set the levels of each endpoint. Every other role gets the endpoints you pick
      here, at most the levels you set for it on each endpoint's Access page. New endpoints and new groups start at None
      for every role.
    </p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <form class="row add" @submit.prevent="create">
      <div class="field grow">
        <input v-model="newName" placeholder="New role name" aria-label="New role name" maxlength="64" />
      </div>
      <button class="btn btn-primary" type="submit" :disabled="!newName.trim()">Add role</button>
    </form>

    <div v-for="r in roles" :key="r.id" class="card role" :data-role="r.name">
      <div class="row">
        <h2 :id="`${uid}-${r.id}`" class="grow">
          {{ r.name }} <span v-if="r.isDefault" class="pill info">default for new users</span>
        </h2>
        <span class="small muted">{{ r.users }} {{ r.users === 1 ? 'user' : 'users' }}</span>
        <template v-if="!r.isAdmin">
          <button class="btn btn-sm" type="button" :aria-describedby="`${uid}-${r.id}`" @click="rename(r)">
            Rename
          </button>
          <button class="btn btn-sm btn-danger" type="button" :aria-describedby="`${uid}-${r.id}`" @click="remove(r)">
            Delete
          </button>
        </template>
      </div>
      <p v-if="r.isAdmin" class="small muted">
        Built in. Every endpoint, at the endpoint's own levels, and every setting.
      </p>
      <template v-else>
        <div class="other">
          <label class="row small check">
            <input
              type="checkbox"
              :checked="r.canSeeOtherEndpoints"
              :aria-describedby="`${uid}-${r.id}-other`"
              @change="flipOther(r)"
            />
            See other endpoints
          </label>
          <p :id="`${uid}-${r.id}-other`" class="small muted">
            Users see the other endpoints by name and description, without access.
          </p>
        </div>
        <h3 :id="`${uid}-${r.id}-endpoints`" class="small">Endpoints</h3>
        <ul class="endpoints" :aria-labelledby="`${uid}-${r.id} ${uid}-${r.id}-endpoints`">
          <li v-for="i in instances" :key="i.id" class="endpoint" :data-endpoint="i.slug">
            <div class="row">
              <label class="row small check">
                <input
                  type="checkbox"
                  :checked="!!endpointOf(r, i.id)"
                  @change="toggleEndpoint(r, i, $event.target as HTMLInputElement)"
                />
                <span :id="`${uid}-${r.id}-${i.id}`" class="mono">/{{ i.slug }}</span>
              </label>
              <RouterLink
                v-if="endpointOf(r, i.id)"
                class="small"
                :to="`/endpoints/${i.slug}/access?role=${r.id}`"
                :aria-describedby="`${uid}-${r.id}-${i.id}`"
              >
                levels…
              </RouterLink>
            </div>
            <div
              v-if="endpointOf(r, i.id)"
              class="switches"
              role="group"
              :aria-label="`${r.name}: switches on /${i.slug}`"
            >
              <span v-for="sw in ENDPOINT_SWITCHES" :key="sw.key" class="switch">
                <label class="row small check">
                  <input
                    type="checkbox"
                    :checked="endpointOf(r, i.id)?.[sw.key]"
                    @change="flipSwitch(r, i.id, sw.key)"
                  />
                  {{ sw.label }}
                </label>
                <InfoTip :text="sw.help" :label="`About ${sw.label}`" />
              </span>
            </div>
          </li>
          <li v-if="!instances.length" class="muted small">No endpoints yet.</li>
        </ul>
      </template>
    </div>
    <p v-if="!custom.length" class="small muted">No roles besides Admin yet.</p>
  </div>
</template>

<style scoped>
.add {
  align-items: center;
}
.add .field {
  margin: 0;
}
.role {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.other p {
  margin: 2px 0 0 24px;
}
h3 {
  margin: 0;
}
.endpoints {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.endpoint {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.switches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin: 6px 0 0 24px;
}
.switch {
  display: inline-flex;
  align-items: center;
}
@media (max-width: 720px) {
  .switches {
    flex-direction: column;
    margin-left: 0;
  }
}
</style>
