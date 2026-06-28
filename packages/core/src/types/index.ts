// Central Worker bindings & shared API response types
export * from "./env";

// Shared API response types
export interface TagResponse {
  id: number;
  label: string;
  slug: string;
}

export interface EntryResponse {
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
  annotations: unknown[];
  authors?: string;
}

export interface CollectionResponse<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface UserInfoResponse {
  id: number;
  username: string;
  email?: string;
  name?: string;
  createdAt: string;
}

export interface ErrorResponse {
  error: { code: number; message: string };
}
