# CLIP website, static pages

One HTML file per page of the CLIP website, exported on November 12, 2026 from the published version of the site.

| File | Page |
|---|---|
| `index.html` | Home |
| `about.html` | About |
| `events.html` | Events |
| `biohackathon.html` | Biohackathon |
| `speakers.html` | Speakers |
| `board.html` | Board |
| `resources.html` | Resources |
| `faq.html` | FAQ |

Shared files in `assets/`:
- `site.css`: all the styles.
- `site.js`: scales the layout to the screen, switches to the phone layout below 1000px wide, and runs the phone menu, the Copy buttons, the sign-up forms and the Ask CLIP chat.
- `clip-facts.js`: what Ask CLIP answers from (the FAQ, the board, events and speakers).
- `clip-logo.png`, `clip-mark.png`: the logos.

Open `index.html` in a browser. The links between pages work without a server. The fonts come from Google Fonts, so they need an internet connection.

## How a page is built
Each page is a stack of full-width sections (`<section class="fsec">`). Inside a section, every element (`<div class="el">`) sits at a fixed spot in a design box that is 1180px wide on desktop and 326px wide on phones:
- `style` holds its position: `--x`, `--y` and `--w` for desktop, `--mx`, `--my` and `--mw` for phones, plus `--r` for rotation.
- `data-d` and `data-m` hold its full desktop and phone boxes (left, top, width, height).
- Elements with the class `m-hide` don't show on phones.

## What these files don't do
- The sign-up forms don't save anything. They point people to the club email until the site has its server.
- Ask CLIP answers from the FAQ only.
- The editor isn't included. Edit the site in the editor, then export again.
