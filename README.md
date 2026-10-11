# Shopping list

A small, responsive grocery checklist with no account, backend, or build step.

## Use locally

Open `index.html` in a browser. Paste your list and select **Save list**, check what
you have at home, then select **Generate shopping list** and **Copy**.
Use **Edit list** to update items or categories.

Markdown, plain text, and structured HTML clipboard content are supported.
The result displays readable headings and bullet lists; copied text uses category
names and simple dash bullets, without Markdown heading symbols.

Your checklist and checkbox states are stored in that browser's localStorage.
Each browser and site address has its own list. Clearing site data removes it.

## Static hosting

Publish `index.html`, `styles.css`, `app.js`, and `favicon.svg` together in the
same directory on any static web server. HTTPS enables the modern clipboard API;
the app also provides a fallback for copying.

Live site: https://shopping-list.152.53.101.9.nip.io/

The current VPS serves `/opt/shopping-list` using the `shopping-list-site` nginx
container, with HTTPS managed by the existing `lastochka-caddy` container.
To update it, copy the four public files into that directory. No container
rebuild or restart is needed. SSH credentials are not part of this repository.

## Files

- `index.html`: page structure and browser metadata
- `styles.css`: responsive layout and result styling
- `app.js`: import, editing, persistence, and shopping list generation
- `favicon.svg`: browser tab icon

## Quick check

Run `node --check app.js` if Node.js is installed. Node.js is not needed to use
or host the app.
