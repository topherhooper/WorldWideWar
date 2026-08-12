# Deploying

One small VM, one Node process, one directory of game snapshots, and Caddy in
front for TLS. There is no database, no container orchestration and no load
balancer, and that is a deliberate match to how the server works rather than a
corner cut — see [Why one box](#why-one-box) at the end.

## What you need first

- A domain you control, and the ability to add an `A` record.
- A Google Cloud project with billing enabled.
- `gcloud` installed locally, or the Cloud Shell.

## 1. Create the VM

An `e2-micro` is enough: the whole server is one Node process holding a few
megabytes of game state. GCE has historically offered one always-free `e2-micro`
in some US regions — worth confirming against current terms, since the free tier
changes and this guide cannot.

```bash
gcloud compute instances create worldwidewar \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --tags=http-server,https-server
```

Open the two ports Caddy needs. Most projects already have these rules from the
default network; creating them again is harmless if they exist.

```bash
gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 --target-tags=http-server --description="Caddy: ACME challenge and redirect"

gcloud compute firewall-rules create allow-https \
  --allow=tcp:443 --target-tags=https-server --description="Caddy: TLS"
```

Nothing needs to open port 8787. The server binds to `127.0.0.1`, so Caddy is
the only thing that can reach it.

## 2. Give it a stable address

An ephemeral IP changes when the VM stops, which would break DNS and the
certificate with it.

```bash
gcloud compute addresses create worldwidewar-ip --region=us-central1
gcloud compute addresses describe worldwidewar-ip --region=us-central1 --format='value(address)'
```

Assign that address to the instance, then point your domain's `A` record at it.
**Wait for DNS to resolve before the next step** — Caddy proves control of the
domain over HTTP to get a certificate, and it cannot do that until the name
points at the VM.

```bash
dig +short play.example.com   # should print your reserved IP
```

## 3. Install and start

```bash
gcloud compute ssh worldwidewar --zone=us-central1-a

sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/topherhooper/WorldWideWar.git
sudo WWW_DOMAIN=play.example.com ./WorldWideWar/deploy/setup.sh
```

That installs Node 22, pnpm and Caddy, creates a `worldwidewar` service account,
builds the project, and starts both services. It ends by waiting for the server
to answer, so a successful run means it is actually up — not merely installed.

Visit `https://play.example.com`.

## Deploying a change

Re-run the same script. It is idempotent: fetch, rebuild, restart.

```bash
sudo WWW_DOMAIN=play.example.com /opt/worldwidewar/deploy/setup.sh
```

Games in progress survive this. The server catches `SIGTERM`, stops accepting
connections, and waits for every queued snapshot to reach disk before exiting;
on the way back up it reads them all in. A turn whose deadline passed during the
restart resolves on the next tick, through the ordinary late-turn path rather
than anything special-cased.

## Configuration

The server takes everything from the environment. The systemd unit sets these;
they matter if you run it anywhere else.

| Variable      | Default     | What it does                                                                             |
| ------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `PORT`        | `8787`      | Port to listen on.                                                                       |
| `HOST`        | `127.0.0.1` | Interface to bind. Loopback by default — set `0.0.0.0` only to expose directly.          |
| `DATA_DIR`    | _unset_     | Where game snapshots live. **Unset means games vanish on restart.**                      |
| `TRUST_PROXY` | _unset_     | `1` to read the client address from `X-Forwarded-For`. Only behind a proxy that sets it. |

`TRUST_PROXY` is off by default on purpose: a directly exposed server that
believed the header would let any client claim a fresh rate-limit allowance on
every request simply by changing it.

## Operating it

```bash
sudo systemctl status worldwidewar
sudo journalctl -u worldwidewar -f
sudo journalctl -u caddy -f          # certificate problems show up here

ls /var/lib/worldwidewar             # one JSON file per live game
sudo tar czf games-backup.tar.gz /var/lib/worldwidewar
```

Backing up is copying that directory. A game is a seed plus its history, so the
files are small and restoring is putting them back.

## What is already hardened

- **TLS** by Caddy, with automatic renewal, and HSTS set there because only the
  proxy knows the connection was encrypted.
- **The server binds to loopback**, so the game port is not reachable from the
  internet at all.
- **A strict content security policy** on every response. The client loads no
  third-party anything and has no inline script or style, so the policy needs no
  `unsafe-` escape hatch.
- **Seat tokens never appear in a URL** — they travel in a header or a request
  body, keeping them out of proxy logs, browser history and `Referer`.
- **Per-client rate limits**, separated by what a request costs, plus a ceiling
  on live games so a script cannot exhaust memory.
- **A systemd sandbox**: no capabilities, no new privileges, read-only system,
  one writable directory, and a system call filter.

## What is not handled yet

Worth knowing before you invite anyone:

- **No accounts.** A seat is an unguessable token in one browser's local
  storage. Lose the browser, lose the seat; open the invite link on your phone
  and you are a spectator.
- **No notifications.** Nothing tells a player their turn resolved, which is the
  main thing standing between this and a genuinely week-long game.
- **Games expire after 24 hours** of nobody touching them, and are then deleted
  from disk.
- **No backups on a schedule.** The command above is manual.

## Why one box

The server is deliberately stateful and single-process: games live in memory,
turn deadlines fire from an in-process timer, and each browser's event stream is
held open by the process that owns its game. Running two instances breaks all
three at once — a game created on one is invisible on the other, both fire the
same deadline, and a client's stream is attached to whichever it happened to
reach.

That is a fine trade for a long time. Turn resolution is a pure function that
takes milliseconds, so a single small VM handles far more concurrent games than
this is likely to see. When it stops being enough, the seam is visible: the
archive in `packages/server/src/archive.ts` becomes a shared database, the
subscriber map in `store.ts` becomes a pub/sub channel, and turn resolution
takes a lock. None of that is worth doing before there is traffic to justify it.
