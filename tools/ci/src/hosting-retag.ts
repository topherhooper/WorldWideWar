// Republish a Hosting site's live version with a Cloud Run tag on its run rewrites.
//
// firebase-tools 15.26.0 builds each run rewrite from serviceId and region alone and drops
// the `tag` in firebase.preview.json, so after `firebase deploy` the test host's /api/**
// reaches the live (or mothballed) revision instead of the tagged preview one. This is the
// REST repair from docs/deployment.md, "The test host", run by the build instead of by hand:
// a new version with the same files and a tagged config, finalized and released.
//
// Usage: tsx tools/ci/src/hosting-retag.ts <site> <tag>
// Auth: the metadata server inside Cloud Build, or HOSTING_ACCESS_TOKEN when run by hand
// (`HOSTING_ACCESS_TOKEN=$(gcloud auth print-access-token)`).

const API = 'https://firebasehosting.googleapis.com/v1beta1';

interface Rewrite {
  run?: { serviceId: string; region?: string; tag?: string };
  [key: string]: unknown;
}

export interface ServingConfig {
  rewrites?: Rewrite[];
  [key: string]: unknown;
}

/** The same config with `tag` on every Cloud Run rewrite; everything else is untouched. */
export function withRunTag(config: ServingConfig, tag: string): ServingConfig {
  if (!config.rewrites) return config;
  return {
    ...config,
    rewrites: config.rewrites.map((r) => (r.run ? { ...r, run: { ...r.run, tag } } : r)),
  };
}

async function accessToken(): Promise<string> {
  const fromEnv = process.env.HOSTING_ACCESS_TOKEN;
  if (fromEnv) return fromEnv;
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function liveFiles(token: string, version: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let pageToken = '';
  do {
    const page = await call<{
      files?: { path: string; hash: string }[];
      nextPageToken?: string;
    }>(token, 'GET', `${API}/${version}/files?pageSize=1000&pageToken=${pageToken}`);
    for (const f of page.files ?? []) files[f.path] = f.hash;
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

/** True when every Cloud Run rewrite in the config points at `tag`. */
export function allRunRewritesTagged(config: ServingConfig, tag: string): boolean {
  return (config.rewrites ?? []).every((r) => !r.run || r.run.tag === tag);
}

async function main(): Promise<void> {
  const [site, tag] = process.argv.slice(2);
  if (!site || !tag) throw new Error('usage: hosting-retag <site> <tag>');
  const token = await accessToken();

  const live = await call<{ release?: { version?: { name: string; config?: ServingConfig } } }>(
    token,
    'GET',
    `${API}/sites/${site}/channels/live`,
  );
  const current = live.release?.version;
  if (!current) throw new Error(`site ${site} has no live release`);

  const files = await liveFiles(token, current.name);
  const version = await call<{ name: string }>(token, 'POST', `${API}/sites/${site}/versions`, {
    config: withRunTag(current.config ?? {}, tag),
  });
  const populated = await call<{ uploadRequiredHashes?: string[] }>(
    token,
    'POST',
    `${API}/${version.name}:populateFiles`,
    { files },
  );
  // Every hash already belongs to the site, so nothing should need uploading.
  if (populated.uploadRequiredHashes?.length) {
    throw new Error(`${populated.uploadRequiredHashes.length} files unexpectedly need upload`);
  }
  await call(token, 'PATCH', `${API}/${version.name}?update_mask=status`, {
    status: 'FINALIZED',
  });
  await call(
    token,
    'POST',
    `${API}/sites/${site}/channels/live/releases?versionName=${version.name}`,
    { message: `retag run rewrites to ${tag}` },
  );
  console.log(`[retag] released ${version.name} (${Object.keys(files).length} files, tag ${tag})`);

  // Read back what is actually live rather than trusting the release call. An HTTP probe
  // of /api cannot tell the revisions apart once production runs the same routes.
  const after = await call<{ release?: { version?: { name: string; config?: ServingConfig } } }>(
    token,
    'GET',
    `${API}/sites/${site}/channels/live`,
  );
  const released = after.release?.version;
  if (released?.name !== version.name || !allRunRewritesTagged(released.config ?? {}, tag)) {
    throw new Error(`live release is ${released?.name ?? 'missing'}, not a tagged ${version.name}`);
  }
}

if (
  process.argv[1]?.endsWith('hosting-retag.ts') ||
  process.argv[1]?.endsWith('hosting-retag.js')
) {
  main().catch((err: unknown) => {
    console.error('[retag]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
