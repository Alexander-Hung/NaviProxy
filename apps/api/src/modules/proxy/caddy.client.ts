export class CaddyClient {
  constructor(private readonly adminUrl: string) {}

  async loadConfig(config: unknown) {
    const admin = new URL(this.adminUrl);
    const loadUrl = new URL('/load', admin);

    const response = await fetch(loadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: admin.host,
        Origin: `${admin.protocol}//${admin.host}`
      },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      throw new Error(`Caddy reload failed: ${await response.text()}`);
    }
  }
}
