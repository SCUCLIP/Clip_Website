# Content format (v5)

The format is the prototype's (`prototype/clip-website.html`), unchanged. The exact definition is `norm()` and the
tables beside it in `public/shared/model.js`: `KINDS` (text styles), `EL` (element types and their fields), `LISTS`
(list kinds and their item fields), `SETTINGS_FIELDS` and `DATA_FIELDS`. This page explains it in prose.

There are ten docs. The seed is in `content/seed/`, and the database stores the same JSON in `published` and `drafts`.

| Doc | What it holds |
|---|---|
| `home`, `about`, `events`, `biohackathon`, `speakers`, `board`, `resources`, `faq` | one page each: `{ "v": 5, "sections": [...] }` |
| `data` | the shared lists: `events`, `past`, `speakers`, `members`, `highlights` |
| `settings` | `contactEmail`, `instagram`, `footerBlurb`, `footerNote` |

## norm()
`norm(id, doc)` repairs any doc into this shape. It never throws. It keeps only known fields, fills in defaults, picks
the first option for an unknown choice, clamps numbers, cuts text at 4,000 characters and drops elements of unknown
types. A page doc without `v: 5` becomes an empty page. Running it twice gives the same result.

The Worker stores what `norm()` returns. It refuses only a page that isn't `v: 5`, a `data` or `settings` doc that
isn't an object, an unknown doc id and anything over 256 KB.

## Pages
A page is a stack of full-width sections: `{ id, h, mh, bg, elements }`.
- `h` and `mh`: the section's height on desktop and on phones, in design pixels.
- `bg`: `none` (graph paper), `blue` or `yellow`.
- `elements`: in stacking order (the last one is on top).

Each element is `{ id, type, d, m, mHide, r, ...fields }`:
- `d`: its desktop box `{ x, y, w, h }` inside a 1180px-wide design box.
- `m`: its phone box inside a 326px-wide box, or `null`. With `null`, the element is stacked at the bottom of the
  section on phones.
- `mHide`: hidden on phones. `r`: rotation in degrees.
- `k` and `mk`: scale, for stamps and figures (`mk` is the phone scale, `null` to use `k`).

Heights are measurements. After each render, `layoutSection()` measures every element; if one came out taller than
its `h`, everything below it that overlaps it horizontally moves down by the difference, and the section grows. The
editor stores the drawn positions after each change, so the seed settles with nothing to push.

Ids are 3 to 24 letters and digits, unique within the page.

## Element types
| Type | Fields |
|---|---|
| `text` | `text`, `hl` (highlighted words added at the end), `kind` (style), `color`, `fs` (0 = the style's size), `align`, `rule` |
| `image` | `src` (`"logo"` or a photo id), `caption`, `frame` (`polaroid`, `card`, `plain`), `ar` (width to height), `tape`, `alt` |
| `button` | `label`, `url`, `style` (`primary`, `secondary`) |
| `link` | `label`, `url` |
| `doodle` | `sym` (one of 12 drawings), `faint` |
| `note` | `text`, `color` (`yellow`, `blue`) |
| `stamp` | `text` |
| `figure` | `fig` (one of 8 lab figures, with a fixed caption) |
| `entry` | `tag`, `label`, `pg` (`"this"`: this page's number; a page id: a link to that page) |
| `contact` | `lead` (the club email and a Copy button follow) |
| `line` | `style` (`dashed`, `solid`) |
| `signup` | `list`, `eyebrow`, `title`, `body`, `buttonLabel`, `okText`, `contact` |
| `form` | `list`, `label`, `buttonLabel`, `okText` |
| `callout` | `title`, `body`, `showEmail`, `color` |
| `list` | `src` (the list kind), and per kind: `limit` (`all`, `3`, `6`), `showLinks`, `more`, `empty`, `items` |

On each page, the first sign-up note for the `weekly` list gets `id="join"`, which is where `#join` links go.

## Lists
`events`, `past`, `speakers`, `members` and `highlights` are shared: they live in the `data` doc, and every list
element of that kind, on any page, shows them. `faq`, `roles`, `cards`, `status`, `steps` and `chips` keep their own
`items`.

## Text
Text is plain. When it's shown, it's escaped, `[square brackets]` are marked as unwritten
(`<span class="ph">`), and line breaks become `<br>`. Nothing in the content is ever used as HTML.

## Links
A `url` is stored as typed and checked when it's shown (`safeHref()`): only `https://...` and `#page` or `#anchor`
links become links. The public site writes `#about` as `/about`, `#home` as `/` and `#join` as `/#join`.

## Photos
Uploaded photos are stored by id (32 hex characters) and served at `/photos/<id>`. `"logo"` is the built-in CLIP logo.
