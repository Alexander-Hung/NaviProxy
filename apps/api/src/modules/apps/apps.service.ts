import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { NaviDatabase } from '../../db/database.js';
import type { ProxyService } from '../proxy/proxy.service.js';
import { AppsRepo } from './apps.repo.js';
import type { AppRecord, AppStatus } from './apps.types.js';

export class AppConflictError extends Error {}

const hostnameLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidHostname(value: string) {
  const host = value.toLowerCase().replace(/\.$/, '');

  if (host.length < 1 || host.length > 253 || host.includes('..')) {
    return false;
  }

  return host.split('.').every((label) => hostnameLabel.test(label));
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProxyOriginUrl(value: string) {
  try {
    const url = new URL(value);

    return url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isSafePublicPath(value: string) {
  return (
    /^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/.test(value) &&
    !value.startsWith('//')
  );
}

const appInputShape = {
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).optional(),
  iconType: z.enum(['url', 'emoji', 'builtin']).default('url'),
  iconValue: z.string().trim().max(500).nullable().optional(),
  targetUrl: z
    .string()
    .trim()
    .url()
    .refine(isHttpUrl, {
      message: 'Target URL must use http or https.'
    })
    .refine(isProxyOriginUrl, {
      message: 'Target URL must be an origin without a path, query, or hash.'
    }),
  routeMode: z.enum(['subdomain', 'subpath']),
  publicHost: z.string().trim().min(1).max(253).refine(isValidHostname, {
    message: 'Public host must be a valid hostname.'
  }),
  publicPath: z.string().trim().max(120).nullable().optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0)
};

function refineRoute(
  value: { routeMode: 'subdomain' | 'subpath'; publicPath?: string | null },
  ctx: z.RefinementCtx
) {
  if (value.routeMode !== 'subpath') {
    return;
  }

  if (!value.publicPath?.startsWith('/')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['publicPath'],
      message: 'Subpath routes must start with /.'
    });
  }

  if (value.publicPath && !isSafePublicPath(value.publicPath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['publicPath'],
      message: 'Subpath route contains unsupported characters or starts with //.'
    });
  }
}

function refineIcon(
  value: { iconType: 'url' | 'emoji' | 'builtin'; iconValue?: string | null },
  ctx: z.RefinementCtx
) {
  if (value.iconType === 'url' && value.iconValue && !isHttpUrl(value.iconValue)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['iconValue'],
      message: 'Icon URL must use http or https.'
    });
  }
}

function refineAppInput(
  value: {
    routeMode: 'subdomain' | 'subpath';
    publicPath?: string | null;
    iconType: 'url' | 'emoji' | 'builtin';
    iconValue?: string | null;
  },
  ctx: z.RefinementCtx
) {
  refineRoute(value, ctx);
  refineIcon(value, ctx);
}

const appInputSchema = z.object(appInputShape).superRefine(refineAppInput);

const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1)
});

const importSchema = z.object({
  mode: z.enum(['replace']).default('replace'),
  apps: z
    .array(
      z
        .object({
          ...appInputShape,
          id: z.string().min(1).optional()
        })
        .superRefine(refineAppInput)
    )
    .min(1)
});

export type AppInput = z.infer<typeof appInputSchema>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizePublicPath(value: string) {
  const normalized = value.trim().replace(/\/+$/g, '');
  return normalized || '/';
}

function normalizeAppInput(input: unknown, fallbackSlug?: string): AppInput {
  const parsed = appInputSchema.parse(input);
  const url = new URL(parsed.targetUrl);
  const slug = slugify(parsed.slug || parsed.name) || fallbackSlug || `app-${nanoid(8)}`;

  return {
    ...parsed,
    slug,
    targetUrl: url.toString().replace(/\/$/, ''),
    publicHost: parsed.publicHost.toLowerCase().replace(/\.$/, ''),
    publicPath:
      parsed.routeMode === 'subpath'
        ? normalizePublicPath(parsed.publicPath || `/${slug}`)
        : null,
    iconValue: parsed.iconValue || null
  };
}

function pathsOverlap(left: string, right: string) {
  if (left === '/' || right === '/') {
    return true;
  }

  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export class AppsService {
  private readonly repo: AppsRepo;

  constructor(
    private readonly db: NaviDatabase,
    private readonly proxyService: ProxyService
  ) {
    this.repo = new AppsRepo(db);
  }

  list() {
    return this.repo.findAll();
  }

  private ensureNoConflict(app: AppRecord, existingId?: string) {
    const slugMatch = this.repo.findBySlug(app.slug);

    if (slugMatch && slugMatch.id !== existingId) {
      throw new AppConflictError(`Slug "${app.slug}" is already used by ${slugMatch.name}.`);
    }

    for (const current of this.repo.findAll()) {
      if (current.id === existingId || current.publicHost !== app.publicHost) {
        continue;
      }

      if (current.routeMode === 'subdomain' || app.routeMode === 'subdomain') {
        throw new AppConflictError(
          `Host "${app.publicHost}" is already covered by ${current.name}.`
        );
      }

      if (pathsOverlap(current.publicPath ?? '/', app.publicPath ?? '/')) {
        throw new AppConflictError(
          `Path "${app.publicPath}" overlaps with ${current.name} at ${current.publicPath}.`
        );
      }
    }
  }

  private ensureImportedAppsAreUnique(apps: AppRecord[]) {
    for (let index = 0; index < apps.length; index += 1) {
      for (let next = index + 1; next < apps.length; next += 1) {
        const left = apps[index];
        const right = apps[next];

        if (left.slug === right.slug) {
          throw new AppConflictError(`Imported apps contain duplicate slug "${left.slug}".`);
        }

        if (left.id === right.id) {
          throw new AppConflictError(`Imported apps contain duplicate id "${left.id}".`);
        }

        if (left.publicHost !== right.publicHost) {
          continue;
        }

        if (
          left.routeMode === 'subdomain' ||
          right.routeMode === 'subdomain' ||
          pathsOverlap(left.publicPath ?? '/', right.publicPath ?? '/')
        ) {
          throw new AppConflictError(
            `Imported apps ${left.name} and ${right.name} have overlapping routes.`
          );
        }
      }
    }
  }

  async create(input: unknown) {
    const normalized = normalizeAppInput(input);
    const now = new Date().toISOString();
    const sortOrder = this.repo.findAll().length;
    const app: AppRecord = {
      id: nanoid(),
      name: normalized.name,
      slug: normalized.slug || slugify(normalized.name),
      iconType: normalized.iconType,
      iconValue: normalized.iconValue ?? null,
      targetUrl: normalized.targetUrl,
      routeMode: normalized.routeMode,
      publicHost: normalized.publicHost,
      publicPath: normalized.publicPath ?? null,
      enabled: normalized.enabled,
      sortOrder,
      createdAt: now,
      updatedAt: now
    };

    this.ensureNoConflict(app);
    const created = this.db.transaction(() => this.repo.create(app))();
    const proxySync = await this.proxyService.syncSafely();
    return { app: created, proxySync };
  }

  async update(id: string, input: unknown) {
    const existing = this.repo.findById(id);

    if (!existing) {
      return null;
    }

    const normalized = normalizeAppInput(input, existing.slug);
    const patch = {
      name: normalized.name,
      slug: normalized.slug || slugify(normalized.name),
      iconType: normalized.iconType,
      iconValue: normalized.iconValue ?? null,
      targetUrl: normalized.targetUrl,
      routeMode: normalized.routeMode,
      publicHost: normalized.publicHost,
      publicPath: normalized.publicPath ?? null,
      enabled: normalized.enabled,
      sortOrder: normalized.sortOrder,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt
    };

    this.ensureNoConflict({ ...patch, id }, id);
    const updated = this.db.transaction(() =>
      this.repo.update(id, patch)
    )();

    const proxySync = await this.proxyService.syncSafely();
    return { app: updated, proxySync };
  }

  async delete(id: string) {
    const deleted = this.db.transaction(() => this.repo.delete(id))();

    if (deleted) {
      const proxySync = await this.proxyService.syncSafely();
      return { deleted, proxySync };
    }

    return { deleted };
  }

  async reorder(input: unknown) {
    const { ids } = reorderSchema.parse(input);
    const existing = this.repo.findAll();
    const existingIds = new Set(existing.map((app) => app.id));
    const requestedIds = new Set(ids);

    if (requestedIds.size !== ids.length) {
      throw new AppConflictError('Reorder list contains duplicate app ids.');
    }

    if (ids.length !== existing.length || ids.some((id) => !existingIds.has(id))) {
      throw new AppConflictError('Reorder list must include every configured app exactly once.');
    }

    this.db.transaction(() => {
      ids.forEach((id, index) => this.repo.updateSortOrder(id, index));
    })();

    const proxySync = await this.proxyService.syncSafely();
    return { apps: this.repo.findAll(), proxySync };
  }

  async checkStatuses(): Promise<AppStatus[]> {
    const apps = this.repo.findAll();

    return Promise.all(
      apps.map(async (app) => {
        const startedAt = Date.now();
        const checkedAt = new Date().toISOString();

        try {
          const response = await fetch(app.targetUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(2500)
          });

          return {
            id: app.id,
            ok: response.status < 500,
            statusCode: response.status,
            responseTimeMs: Date.now() - startedAt,
            checkedAt,
            error: null
          };
        } catch (error) {
          return {
            id: app.id,
            ok: false,
            statusCode: null,
            responseTimeMs: Date.now() - startedAt,
            checkedAt,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );
  }

  exportApps() {
    return {
      exportedAt: new Date().toISOString(),
      apps: this.repo.findAll()
    };
  }

  async importApps(input: unknown) {
    const parsed = importSchema.parse(input);
    const now = new Date().toISOString();
    const apps = parsed.apps.map((appInput, index) => {
      const normalized = normalizeAppInput(appInput);

      return {
        id: appInput.id ?? nanoid(),
        name: normalized.name,
        slug: normalized.slug || slugify(normalized.name),
        iconType: normalized.iconType,
        iconValue: normalized.iconValue ?? null,
        targetUrl: normalized.targetUrl,
        routeMode: normalized.routeMode,
        publicHost: normalized.publicHost,
        publicPath: normalized.publicPath ?? null,
        enabled: normalized.enabled,
        sortOrder: index,
        createdAt: now,
        updatedAt: now
      };
    });

    this.ensureImportedAppsAreUnique(apps);
    const savedApps = this.repo.replaceAll(apps);
    const proxySync = await this.proxyService.syncSafely();

    return { apps: savedApps, proxySync };
  }
}
