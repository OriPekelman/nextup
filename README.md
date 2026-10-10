# NextUp

A tiny, file-based web app for running a party queue.

People scan a QR code, land on a page, and drop in a poem, a picture, a link, a YouTube video. You project the **show** page on a TV and advance through the queue with the arrow keys. That's it.

## Features

- Three interfaces per party ("nextup"):
  - `/:slug`          contribute (text / image / URL / YouTube)
  - `/:slug/manage`   reorder, delete, see history, get the QR code
  - `/:slug/show`     minimal presenter view — Next / Prev / arrow keys
- `/` lets you create a new nextup with a chosen or random slug
- No database. One JSON file per nextup in `data/`, images in `uploads/`
- No authentication. The URL slug is the (weak) shared secret — pick something you don't mind guests knowing.
- Contributors can insert their item anywhere in the queue **except** the top slot ("next up" is locked in). Default behaviour is Last-In-Last-Out (append to end).
- Manage page can delete anything and reorder upcoming items freely.

## Run it

Requires Node 18+.

```bash
npm install
npm start
```

Then open http://localhost:3000.

### Configuration

Copy `.env.example` to `.env` (or export env vars directly):

| Variable    | Default                 | Notes                                                |
| ----------- | ----------------------- | ---------------------------------------------------- |
| `BASE_URL`  | `http://localhost:3000` | Used for QR codes + displayed share links           |
| `PORT`      | `3000`                  | Port to bind                                         |
| `APP_NAME`  | `NextUp`                | Displayed in page titles / header                    |

Put a reverse proxy (Caddy, nginx, Cloudflare Tunnel) in front if you're hosting this for a real party.

## URLs at a glance

```
/                  create a new nextup
/:slug             contribute page (upload/paste/insert)
/:slug/manage      moderator UI (delete, reorder, QR, history)
/:slug/show        presenter view (next/prev)
```

## Data model

Each nextup is a JSON file at `data/<slug>.json`:

```json
{
  "slug": "wvgd",
  "title": "Weekend Vibes",
  "created": "2026-04-17T18:00:00.000Z",
  "currentIndex": 2,
  "items": [
    {
      "id": "ab12cd34",
      "type": "text" | "image" | "url" | "youtube",
      "content": "poem text, or /uploads/wvgd/xxx.jpg, or a URL",
      "caption": "optional",
      "contributor": "Ori",
      "added": "2026-04-17T18:10:00.000Z",
      "shown": true,
      "shownAt": "2026-04-17T18:12:00.000Z"
    }
  ]
}
```

- `currentIndex` = array index of the item currently on stage (`-1` if nothing has been shown).
- Items at index `< currentIndex` are history.
- Item at `currentIndex + 1` is the untouchable "next up".
- Items beyond that are freely orderable.

## Presenter keyboard shortcuts

| Key                  | Action              |
| -------------------- | ------------------- |
| `→` / `Space` / `PgDn` | Next                |
| `←` / `PgUp`         | Previous            |
| `f`                  | Toggle fullscreen   |

## Roadmap ideas (later)

- Push updates over WebSocket instead of polling
- Optional contributor cookies to let people edit / move their own item before it plays
- Spotify Jam integration (add a track to the party's jam when the item is a Spotify URL)
- Reactions ("cheer" on an item from the audience phones)
- Per-item timer / auto-advance for "slideshow" mode
- Simple moderation PIN on `/manage`

## License

MIT
