import type { AppRecord } from '../apps/apps.types.js';

type CaddyRoute = Record<string, unknown>;

function upstreamDial(targetUrl: string) {
  const url = new URL(targetUrl);
  return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

function reverseProxyHandle(app: AppRecord) {
  const url = new URL(app.targetUrl);

  return {
    handler: 'reverse_proxy',
    upstreams: [{ dial: upstreamDial(app.targetUrl) }],
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

export function buildCaddyConfig(apps: AppRecord[], listen: string) {
  const routes = apps.map((app) =>
    app.routeMode === 'subdomain'
      ? buildSubdomainRoute(app)
      : buildSubpathRoute(app)
  );

  return {
    apps: {
      http: {
        servers: {
          naviproxy: {
            listen: [listen],
            routes
          }
        }
      }
    }
  };
}
