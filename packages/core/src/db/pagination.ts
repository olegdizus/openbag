// Pagination helper with HATEOAS link generation

export interface PaginationParams {
  page: number;
  perPage: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface PaginationLinks {
  self: string;
  first: string;
  last: string;
  next?: string;
  prev?: string;
}

export interface CollectionResponse<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
  _links: PaginationLinks;
}

export function createPaginationLinks(
  basePath: string,
  params: PaginationParams,
  total: number,
  extraParams: Record<string, string> = {}
): PaginationLinks {
  const { page, perPage } = params;
  const pages = Math.ceil(total / perPage) || 1;

  const buildUrl = (p: number): string => {
    const qs: string[] = [];
    qs.push(`page=${encodeURIComponent(p)}`);
    qs.push(`perPage=${encodeURIComponent(perPage)}`);
    for (const [k, v] of Object.entries(extraParams)) {
      qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return basePath + "?" + qs.join("&");
  };

  const links: PaginationLinks = {
    self: buildUrl(page),
    first: buildUrl(1),
    last: buildUrl(pages),
  };

  if (page < pages) {
    links.next = buildUrl(page + 1);
  }
  if (page > 1) {
    links.prev = buildUrl(page - 1);
  }

  return links;
}

export function applyPagination<T>(
  items: T[],
  total: number,
  params: PaginationParams,
  basePath: string,
  extraParams: Record<string, string> = {}
): CollectionResponse<T> {
  return {
    items,
    total,
    page: params.page,
    pages: Math.ceil(total / params.perPage) || 1,
    _links: createPaginationLinks(basePath, params, total, extraParams),
  };
}
