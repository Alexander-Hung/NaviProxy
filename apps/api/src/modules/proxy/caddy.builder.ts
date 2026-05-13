import type { AppRecord } from '../apps/apps.types.js';
import type { TlsMode } from '../settings/settings.service.js';

type CaddyRoute = Record<string, unknown>;

function upstreamDial(targetUrl: string) {
  const url = new URL(targetUrl);
  return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

function reverseProxyTarget(targetUrl: string) {
  const url = new URL(targetUrl);

  return {
    handler: 'reverse_proxy',
    upstreams: [{ dial: upstreamDial(targetUrl) }],
    ...(url.protocol === 'https:'
      ? {
          transport: {
            protocol: 'http',
            tls: {}
          }
        }
      : {})
  };
}

function reverseProxyHandle(app: AppRecord) {
  return reverseProxyTarget(app.targetUrl);
}

function buildSubdomainRoute(app: AppRecord): CaddyRoute {
  return {
    match: [{ host: [app.publicHost] }],
    handle: [reverseProxyHandle(app)]
  };
}

function buildSubpathRoute(app: AppRecord): CaddyRoute {
  const publicPath = app.publicPath ?? `/${app.slug}`;
  const pathMatcher =
    publicPath === '/' ? ['/*'] : [publicPath, `${publicPath}/*`];

  return {
    match: [
      {
        host: [app.publicHost],
        path: pathMatcher
      }
    ],
    handle: [
      {
        handler: 'subroute',
        routes: [
          {
            handle: [
              {
                handler: 'rewrite',
                strip_path_prefix: publicPath
              },
              reverseProxyHandle(app)
            ]
          }
        ]
      }
    ]
  };
}

function buildDashboardRoute(dashboardTargetUrl: string): CaddyRoute {
  return {
    handle: [reverseProxyTarget(dashboardTargetUrl)]
  };
}

export function buildCaddyConfig(
  apps: AppRecord[],
  listen: string,
  dashboardTargetUrl: string,
  tlsMode: TlsMode = 'http'
) {
  const routes = apps.map((app) =>
    app.routeMode === 'subdomain'
      ? buildSubdomainRoute(app)
      : buildSubpathRoute(app)
  );

  routes.push(buildDashboardRoute(dashboardTargetUrl));

  const server = {
    listen: tlsMode === 'http' ? [listen] : [listen, ':443'],
    routes,
    ...(tlsMode === 'http' ? {} : { tls_connection_policies: [{}] })
  };
  const config = {
    apps: {
      http: {
        servers: {
          the_containers: server
        }
      }
    }
  };

  if (tlsMode === 'internal_ca') {
    return {
      ...config,
      apps: {
        ...config.apps,
        tls: {
          automation: {
            policies: [
              {
                issuers: [{ module: 'internal' }]
              }
            ]
          }
        }
      }
    };
  }

  return config;
}
