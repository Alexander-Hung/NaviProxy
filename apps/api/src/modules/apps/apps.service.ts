import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { NaviDatabase } from '../../db/database.js';
import type { ProxyService } from '../proxy/proxy.service.js';
import { AppsRepo } from './apps.repo.js';
import type { AppRecord } from './apps.types.js';

const appInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().trim().min(1).max(80).optional(),
    iconType: z.enum(['url', 'emoji', 'builtin']).default('url'),
    iconValue: z.string().trim().max(500).nullable().optional(),
    targetUrl: z.string().trim().url(),
    routeMode: z.enum(['subdomain', 'subpath']),
    publicHost: z.string().trim().min(1).max(253),
    publicPath: z.string().trim().max(120).nullable().optional(),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().min(0).default(0)
  })
  .superRefine((value, ctx) => {
    if (value.routeMode === 'subpath') {
      if (!value.publicPath?.startsWith('/')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['publicPath'],
          message: 'Subpath routes must start with /.'
        });
      }
    }
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

function normalizeAppInput(input: unknown): AppInput {
  const parsed = appInputSchema.parse(input);
  const url = new URL(parsed.targetUrl);

  return {
    ...parsed,
    slug: slugify(parsed.slug || parsed.name),
    targetUrl: url.toString().replace(/\/$/, ''),
    publicHost: parsed.publicHost.toLowerCase(),
    publicPath:
      parsed.routeMode === 'subpath'
        ? normalizePublicPath(
            parsed.publicPath || `/${slugify(parsed.slug || parsed.name)}`
          )
        : null,
    iconValue: parsed.iconValue || null
  };
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

  async create(input: unknown) {
    const normalized = normalizeAppInput(input);
    const now = new Date().toISOString();
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
      sortOrder: normalized.sortOrder,
      createdAt: now,
      updatedAt: now
    };

    const created = this.db.transaction(() => this.repo.create(app))();
    await this.proxyService.sync();
    return created;
  }

  async update(id: string, input: unknown) {
    const existing = this.repo.findById(id);

    if (!existing) {
      return null;
    }

    const normalized = normalizeAppInput(input);
    const updated = this.db.transaction(() =>
      this.repo.update(id, {
        name: normalized.name,
        slug: normalized.slug || slugify(normalized.name),
        iconType: normalized.iconType,
        iconValue: normalized.iconValue ?? null,
        targetUrl: normalized.targetUrl,
        routeMode: normalized.routeMode,
        publicHost: normalized.publicHost,
        publicPath: normalized.publicPath ?? null,
        enabled: normalized.enabled,
        sortOrder: normalized.sortOrder
      })
    )();

    await this.proxyService.sync();
    return updated;
  }

  async delete(id: string) {
    const deleted = this.db.transaction(() => this.repo.delete(id))();

    if (deleted) {
      await this.proxyService.sync();
    }

    return deleted;
  }
}
