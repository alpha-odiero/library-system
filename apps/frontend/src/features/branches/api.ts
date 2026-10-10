import { api, type Paginated } from '../../lib/api';

/**
 * Branches.
 *
 * Read-only, mirroring the backend. The DTO is a projection: `id`, `code` and
 * `name` are what a picker needs, and the contact fields are here for a future
 * branch profile page — not for the select.
 */
export interface BranchDto {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  openedAt: string | null;
  createdAt: string;
}

export function listBranches(
  filters: { q?: string; includeInactive?: boolean; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Paginated<BranchDto>> {
  return api.get<BranchDto[]>('/branches', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<BranchDto>>;
}

export function getBranch(id: string, signal?: AbortSignal) {
  return api.get<{ branch: BranchDto }>(`/branches/${id}`, signal ? { signal } : {});
}
