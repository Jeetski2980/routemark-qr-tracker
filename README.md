# RouteMark

RouteMark is a local QR code redirect and visit tracker. It generates QR images on your computer, sends each code through your own redirect server, and keeps only daily visit totals. It has no QR service account, subscription, analytics vendor, or external font dependency.

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

The dashboard binds to `127.0.0.1` by default. When you bind it to a network address with `HOST=0.0.0.0`, an `ADMIN_PASSWORD` is required. The redirect endpoint remains public so a QR can be scanned, while campaign and analytics APIs require the password. Login sessions expire after 24 hours and reset when the server restarts.
