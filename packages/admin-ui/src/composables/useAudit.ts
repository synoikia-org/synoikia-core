import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { http } from '../api';
import type { AuditRow } from '../types';

export const auditKeys = { all: ['audit'] as const };

export const AUDIT_PAGE = 100;

/** One page of the audit log at `offset`; the shown page and its offset stay while the next loads. */
export function useAuditQuery(request: MaybeRefOrGetter<{ query: string; offset: number }>) {
  return useQuery(() => {
    const { query, offset } = toValue(request);
    const search = `${query}${query ? '&' : '?'}limit=${AUDIT_PAGE}&offset=${offset}`;
    return {
      queryKey: [...auditKeys.all, search],
      queryFn: async () => ({
        ...(await http.get<{ rows: AuditRow[]; total: number }>(`/api/audit${search}`)),
        offset,
      }),
      placeholderData: keepPreviousData,
      // The log grows all the time: opening the page always asks for the newest rows.
      staleTime: 0,
    };
  });
}
