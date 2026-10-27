import type { Paginated } from '@autowra/shared-types';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface ResolvedPagination {
  readonly page: number;
  readonly pageSize: number;
  readonly skip: number;
  readonly take: number;
}

export function resolvePagination(query: { page?: number; pageSize?: number } = {}): ResolvedPagination {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginate<T>(items: T[], total: number, paging: ResolvedPagination): Paginated<T> {
  return {
    items,
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / paging.pageSize),
  };
}

export function paginationMeta(paging: ResolvedPagination, total: number) {
  return {
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / paging.pageSize),
  };
}
