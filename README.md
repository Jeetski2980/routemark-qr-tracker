# RouteMark

RouteMark is a self-hosted QR code redirect and visit tracker. It generates QR images in the browser, sends each code through your redirect server, and keeps daily visit totals. It has no QR service account or external font dependency.

## Run locally

Install Node.js 18 or newer, then run:

```sh
npm run dev
```

Open [http://localhost:4174](http://localhost:4174). RouteMark uses Node.js built-ins and browser APIs, so there is no package install or QR service account. Create a campaign with a name and an `http://` or `https://` destination. RouteMark creates a short tracked URL, displays the QR code, and lets you download it as PNG or SVG. Redirect history is stored in `data/store.json` beside the app and is not committed to Git. Set `ROUTEMARK_DATA_DIR` at launch to store data in another folder.

You can also edit campaign destinations, copy tracked URLs, pause or reactivate a code, and delete campaigns. Paused links return a 410 response. Deleting a campaign removes its visit history.

## Scan from another device

`localhost` means “this device,” so a QR code using `localhost` cannot be opened by a phone. To test over the same Wi-Fi, start RouteMark with a LAN listener and an admin password:

```sh
HOST=0.0.0.0 ADMIN_PASSWORD='choose-a-password' npm run dev
```

Find the computer's local network address, such as `192.168.1.25`, then open **Settings** in RouteMark and set **Public base URL** to `http://192.168.1.25:4174`. Allow incoming connections through the computer's firewall if prompted. The phone and computer must be on the same network.

For scans from outside your Wi-Fi, run the server on a publicly reachable HTTPS host or put a secure tunnel/reverse proxy in front of it. Start it with:

```sh
HOST=0.0.0.0 PORT=4174 ADMIN_PASSWORD='choose-a-password' npm start
```

Point the proxy to port `4174`, then set RouteMark's **Public base URL** to the public HTTPS origin (for example, `https://qr.example.com`). Network hosting may have a cost, but QR generation and tracking itself do not require a paid third-party service. The public address must keep routing to this app for scans to continue counting.

## What a visit means

RouteMark increments a count for each request that reaches an active tracked link. Some phone or messaging app link previews open the link automatically and may count as visits too. RouteMark does not save visitor IP addresses, device identifiers, or full request logs; it stores aggregate daily counts per campaign.

## Deploy on Vercel

GitHub Pages can serve static files but cannot run the redirect or counter. This repository also includes a Vercel Function (`api/index.js`) for those routes. Connect the GitHub repository to a Vercel project with the repository root as the project root. Add an Upstash Redis database through Vercel Marketplace and connect it to the project. Configure these **Production** environment variables before creating a QR code:

| Variable | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash REST endpoint supplied by the integration |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash write token supplied by the integration |
| `ADMIN_PASSWORD` | Strong password for the dashboard |
| `SESSION_SECRET` | Random secret for signed login cookies; keep the value stable between deployments |

The hosted function returns a configuration error until all four variables are present. After deployment, open the Vercel URL, sign in, and create a campaign. The QR link uses that public URL automatically. Keep the same Vercel domain and Redis database so printed QR codes and their totals continue to work. Usage may incur hosting or storage charges.

The local dashboard binds to `127.0.0.1` by default. When you bind it to a network address with `HOST=0.0.0.0`, an `ADMIN_PASSWORD` is required. The redirect endpoint remains public so a QR can be scanned, while campaign and analytics APIs require the password. Login sessions expire after 24 hours; on Vercel, `SESSION_SECRET` keeps them valid across function instances and deployments.
