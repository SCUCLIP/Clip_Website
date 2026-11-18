# Content format

All content is JSON: one doc per page plus a `site` doc. The seed docs are in `content/seed/`; the database stores
the same JSON in `published` and `drafts`. `norm()` in `public/shared/norm.js` is the exact definition: it checks a
doc and returns it in canonical form. This page explains it in prose.

## The `site` doc
```json
{
  "id": "site",
  "email": "connectingleaders@scu.edu",
  "instagram": "[@handle]",
  "footer": "Connecting Leaders in Innovation and Pharma. …",
  "notebook": "Notebook 2026-27",
  "nav": [{ "page": "about", "label": "About" }, …],
  "cta": { "label": "Join CLIP", "href": "#join" },
  "chat": { "greeting": "Hi! …", "suggestions": ["When do you meet?", …], "foot": "Answers from the CLIP FAQ.", "boardNote": "…" }
}
```
`email` appears in the footer and in every contact line, Copy button and sign-up sheet. An `instagram` value like
`@scuclip` becomes a link; anything else is shown as text. `chat` is Ask CLIP's greeting, suggested questions, footer
line and the note it adds when asked about the board.

## Page docs
Pages: `home` (served at `/`), `about`, `events`, `biohackathon`, `speakers`, `board`, `resources`, `faq`.
```json
{ "id": "about", "title": "About · CLIP at Santa Clara University", "description": "…", "sections": [ … ] }
```
A page is a stack of full-width **sections**. Each has an `id`, a background `bg` (`none`, `blue`, `yellow`), its
height on desktop `h` and on phones `mh` (design pixels), and its elements `els`.

## Elements
Every element sits at a fixed spot in its section's design box: 1180px wide on desktop, 326px on phones.
| Field | Meaning |
|---|---|
| `id` | unique on the page (letters, digits, `_`, `-`) |
| `type` | one of the types below |
| `d` | desktop box `[x, y, width, height]` |
| `m` | phone box, or `null` for none (phones then stack it automatically, or hide it if `mHide`) |
| `z` | stacking order |
| `r` | rotation in degrees (left out when 0) |
| `mHide` | hidden on phones |
| `faint` | drawn at half opacity |
| `anchor` | an id other links can point at, like `join` (`#join` → `/#join`) |

The height in a box is what the element measured when it was last edited. The public site moves things down when
text renders taller than that (different fonts or browsers), just like the original export.

### Types
| `type` | Fields |
|---|---|
| `text` | `tag` (`p`, `h1`, `h2`, `h3`), `kind` (`eyebrow`, `hero`, `big`, `page`, `section`, `sub`, `lede`, `body`, `small`, `hand`), `color` (`""`, `ink`, `muted`, `pen`, `teal`), `align` (`""`, `center`, `right`), `rule` (dashed line above), `fs` and `mfs` (font size on desktop and phones), `text` (rich) |
| `button` | `label`, `href`, `style` (`primary`, `secondary`) |
| `link` | `label`, `href` (the "Read more →" style) |
| `entry` | `num` ("Entry 002"), `label`, `page` ("See p. 02"), `href` (optional) |
| `figure` | `art` (`aspirin`, `chair`, `tlc`, `mortar`, `ballstick`, `dose`, `sn2`, `rxn`), `alt`, `caption` (rich), `k` (zoom), `mk` (zoom on phones, optional); `rxn` also has `from`, `above`, `below`, `to` |
| `doodle` | `art` (`flask`, `flask-mini`, `benzene`, `capsule`, `tablet`, `tick`, `arrow`) |
| `image` | `photo` (an uploaded photo's id) or `asset` (`clip-logo.png`, `clip-mark.png`), `alt`, `caption` (rich), `frame` (`card`, `polaroid`, `plain`), `tape` (`""`, `blue`, `yellow`), `logo`, `ar` (width / height), `iw`, `ih` (pixel size) |
| `note` | `color` (`yellow`, `blue`), `text` (rich) |
| `line` | `solid` |
| `stamp` | `text` (rich), `k`, `mk` |
| `signup` | the sign-up sheet: `eyebrow`, `title`, `body`, `label`, `placeholder`, `button`, `list`, `ok` (the thank-you message), `contact` |
| `form` | a one-line sign-up: `label`, `placeholder`, `button`, `list`, `ok` |
| `contact` | `text` before the club email and its Copy button |
| `callout` | `title`, `text` before the club email |
| `list` | `kind` and `items`, below |

### List kinds
| `kind` | Item fields |
|---|---|
| `highlights` | `title`, `text` |
| `chips` | `text`, `more` (the faded last chip) |
| `cards` | `title`, `text`, `linkLabel`, `linkHref` |
| `events` | `month`, `day`, `name`, `time`, `location`, `desc`, `linkLabel`, `linkHref` |
| `speakers` | `name`, `when`, `title`, `topic`, `photo` |
| `members` | `name`, `role`, `photo` (initials show when there's no photo) |
| `roles` | `title`, `text` |
| `steps` | `text` (numbered 01, 02, …) |
| `past` | `when`, `what` |
| `faq` | `q`, `a` |
| `status` | `title`, `tag`, `text` |

A link field with a label but no `href` shows the label as a placeholder (like "[RSVP link]").

## Text
- **Plain** fields are stored as typed and escaped when rendered.
- **Rich** fields (`text`, `caption`, note and stamp text) are a small HTML fragment. Only `<br>`, `<b>`, `<i>`,
  `<sub>`, `<sup>` and `<span class="hl">` (the yellow highlight) survive; anything else is escaped and shows as text.
- **Placeholders**: anything in `[square brackets]` is content nobody has written yet. It renders in a different
  style (`<span class="ph">`), and Ask CLIP says "(not posted yet)" instead of reading it out.

## Links
| Stored | Rendered |
|---|---|
| `#home` | `/` |
| `#about` (any page id) | `/about` |
| `#join` (any other name) | `/#join`, an anchor on the home page |
| `https://…` | unchanged |
| `mailto:…` | unchanged |
Anything else (`http:`, `javascript:`, relative paths) is refused when a draft is saved.

## Ask CLIP
Ask CLIP's facts come from published content (`public/shared/facts.js`): the email from `site`, the FAQ list, the
board's `members` list, the Speakers page's `speakers` list, the Events page's `events` list, the Biohackathon page's
description, and `site.chat.boardNote`.

## Sign-up lists
A sign-up is accepted only for a `list` name used by a `signup` or `form` element in published content. Today:
`weekly` (home page) and `biohackathon`.
