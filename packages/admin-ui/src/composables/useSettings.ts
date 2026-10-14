import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { http } from '../api';
import { computed } from 'vue';
import { AUTH_METHODS } from '../types';
import type { SeenClient, Settings } from '../types';
import { useApiMutation } from './useApiMutation';

export const settingsKeys = {
  all: ['settings'] as const,
  clientsSeen: ['settings', 'mcp', 'clients-seen'] as const,
};

type Section = 'security' | 'audit' | 'mcp' | 'oidc';

export function useSettingsQuery() {
  return useQuery({ queryKey: settingsKeys.all, queryFn: () => http.get<Settings>('/api/settings') });
}

/** Saves one section; core's answer replaces that section in the cache, leaving the others as they are. */
export function useSaveSettings<S extends Section>(section: S) {
  const queryClient = useQueryClient();
  return useApiMutation(async (body: unknown) => {
    const saved = await http.put<NonNullable<Settings[S]>>(`/api/settings/${section}`, body);
    queryClient.setQueryData<Settings>(settingsKeys.all, (old) => old && { ...old, [section]: saved });
    return saved;
  });
}

/** The client auth methods enabled under Settings → Client auth; undefined until the settings load. */
export function useEnabledAuthMethods() {
  const settingsQuery = useSettingsQuery();
  return computed(() => {
    const on = settingsQuery.data.value?.mcp.clientAuth;
    return on && AUTH_METHODS.filter((m) => on[m]);
  });
}

/** Client names seen at MCP initialize, newest first: suggestions for the client policy. */
export function useClientsSeenQuery() {
  return useQuery({
    queryKey: settingsKeys.clientsSeen,
    queryFn: () => http.get<SeenClient[]>('/api/settings/mcp/clients-seen'),
  });
}
