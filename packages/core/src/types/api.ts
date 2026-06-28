// Typia-validated shared API types

export interface EntryResponse {
  _links: {
    self: { href: string };
  };
  id: number;
  title: string;
  url: string;
  origin_url?: string;
  content?: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
  is_archived: 0 | 1;
  is_starred: 0 | 1;
  is_public: 0 | 1;
  domain_name?: string;
  language?: string;
  mimetype: string;
  preview_picture?: string;
  reading_time: number;
  tags: TagResponse[];
  annotations: AnnotationResponse[];
  authors?: string;
}

export interface TagResponse {
  id: number;
  label: string;
  slug: string;
}

export interface AnnotationResponse {
  id: string;
  text: string;
  quote?: string;
  ranges: RangeResponse[];
}

export interface RangeResponse {
  start: string;
  end: string;
  startOffset: number;
  endOffset: number;
}

export interface CollectionResponse<T> {
  _embedded: {
    items: T[];
  };
  _links: {
    self: { href: string };
    first?: { href: string };
    last?: { href: string };
    next?: { href: string };
  };
  limit: number;
  page: number;
  pages: number;
  total: number;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string | null;
  token_type: "bearer";
}

export interface ErrorResponse {
  error: {
    code: number;
    message: string;
  };
}
