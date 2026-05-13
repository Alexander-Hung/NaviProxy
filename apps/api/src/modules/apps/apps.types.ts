export type RouteMode = 'subdomain' | 'subpath';
export type IconType = 'url' | 'emoji' | 'builtin';

export type AppRecord = {
  id: string;
  name: string;
  slug: string;
  iconType: IconType;
  iconValue: string | null;
  targetUrl: string;
  routeMode: RouteMode;
  publicHost: string;
  publicPath: string | null;
  enabled: boolean;
  sortOrder: number;
  category: string | null;
  tags: string[];
  favorite: boolean;
  managedDeployment: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AppRow = {
  id: string;
  name: string;
  slug: string;
  icon_type: IconType;
  icon_value: string | null;
  target_url: string;
  route_mode: RouteMode;
  public_host: string;
  public_path: string | null;
  enabled: number;
  sort_order: number;
  category: string | null;
  tags: string;
  favorite: number;
  managed_deployment?: number;
  created_at: string;
  updated_at: string;
};

export type AppStatus = {
  id: string;
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  checkedAt: string;
  error: string | null;
};
