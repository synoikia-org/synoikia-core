import { useQuery } from '@tanstack/vue-query';
import { computed, toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { http } from '../api';
import type { MyEndpoints, UnassignedEndpointAbout } from '../types';

export const myEndpointKeys = {
  all: ['me', 'endpoints'] as const,
  about: (id: string) => ['me', 'endpoints', id, 'about'] as const,
};

/** The signed-in user's endpoints, for every role, and the others their role may see by name. */
export function useMyEndpointsQuery(enabled: MaybeRefOrGetter<boolean> = true) {
  const query = useQuery({
    queryKey: myEndpointKeys.all,
    queryFn: () => http.get<MyEndpoints>('/api/me/endpoints'),
    enabled,
  });
  return {
    ...query,
    endpoints: computed(() => query.data.value?.assigned ?? []),
    unassigned: computed(() => query.data.value?.unassigned ?? []),
  };
}

/** One endpoint outside the user's role, by name only. */
export const useMyEndpointAboutQuery = (id: MaybeRefOrGetter<string>) =>
  useQuery(() => ({
    queryKey: myEndpointKeys.about(toValue(id)),
    queryFn: () => http.get<UnassignedEndpointAbout>(`/api/me/endpoints/${encodeURIComponent(toValue(id))}/about`),
  }));
