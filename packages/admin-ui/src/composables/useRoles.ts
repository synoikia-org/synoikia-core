import { useQuery } from '@tanstack/vue-query';
import { http } from '../api';
import type { EndpointSwitches, RoleRow } from '../types';
import { useApiMutation } from './useApiMutation';
import { userKeys } from './useUsers';

export const roleKeys = { all: ['roles'] as const };

type RolePatch = Partial<Pick<RoleRow, 'name' | 'canSeeOtherEndpoints'>>;

// Users show their role's name, so role writes refresh the users too.
const changed = () => [roleKeys.all, userKeys.all];

export function useRolesQuery() {
  return useQuery({ queryKey: roleKeys.all, queryFn: () => http.get<RoleRow[]>('/api/roles') });
}

export function useCreateRole() {
  return useApiMutation((name: string) => http.post('/api/roles', { name }), changed());
}

export function useUpdateRole() {
  return useApiMutation(
    ({ id, ...patch }: RolePatch & { id: string }) => http.patch(`/api/roles/${id}`, patch),
    changed(),
  );
}

export function useDeleteRole() {
  return useApiMutation((id: string) => http.del(`/api/roles/${id}`), changed());
}

export function useSetRoleInstances() {
  return useApiMutation(
    ({ id, instanceIds }: { id: string; instanceIds: string[] }) =>
      http.put(`/api/roles/${id}/instances`, { instanceIds }),
    changed(),
  );
}

export function useSetRoleEndpointSwitches() {
  return useApiMutation(
    ({ id, instanceId, ...patch }: Partial<EndpointSwitches> & { id: string; instanceId: string }) =>
      http.patch(`/api/roles/${id}/endpoints/${instanceId}`, patch),
    changed(),
  );
}
