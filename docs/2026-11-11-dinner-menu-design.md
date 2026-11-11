# Dinner menu page (`/dinner-menu`) - working design

Status: DRAFT, in discussion. Scope is the menu page only. Album window and the
n8n reminder work are parked in `2026-11-11-album-and-reminders-parked.md` and
resume after sections 1-4 below are settled.

Reception: 28 Nov 2026, 6-9 pm IST, New Woodlands Hotel, Chennai.

## Settled

- Route: `/dinner-menu` (`src/pages/dinner-menu.astro`), always public.
- Uses `Base` and `Header`, same cream/teal look as the rest of the site.
- Content lives in a `menu` content collection (`src/content/menu/menu.json`,
  `file()` loader like `event.json`), one entry per category in display order.
  Item fields: `name`, `description?`, `photo?`.
- Empty collection renders "Menu coming soon" so the page is safe to ship early.

## Sections to settle (in order)

### 1. Layout - SETTLED
One long scrolling page of category sections. Each category: a heading, then a
2-column grid of photo cards (photo on top, name and optional short description
below). No sticky tabs and no list rows. The grid stays 2 columns on phones and
may widen on larger screens, matching the existing `album-grid` approach.

### 2. Content - SETTLED
Source: the couple's list (2026-11-11). Order follows the serving order, which
starts with a sweet by tradition. Descriptions are written from the dish names
(not from the couple's notes) and are for the couple to approve.

| Category | Dish | Description |
|---|---|---|
| Sweet | Putharekulu | Delicate rice-starch wafers layered with sugar and ghee, folded into a sweet parcel. |
| Starters | Gobi 65 | Crisp-fried cauliflower florets tossed in a spiced, tangy South Indian masala. |
| Starters | Bhindi Fry | Tender okra pan-fried with spices until golden and crisp. |
| Starters | Rasa Vadai | Soft lentil fritters soaked in peppery, tangy rasam. |
| Mains | Phulka | Soft, puffed whole-wheat flatbread, served hot. Served with: Navaratan Korma. |
| Mains | Idiyappam | Delicate steamed rice noodles, Served with: Coconut Milk. |
| Mains | Brinji Rice | Fragrant spiced vegetable rice in the Madras style. Served with: Potato Chips, Navaratan Korma, Cucumber Raita. |
| Mains | Curd Rice | Cool, creamy curd rice, a comforting South Indian classic. Served with: Pickle. |
| Desserts | Vanilla Ice Cream | Classic, creamy vanilla ice cream. |
| Desserts | Chocolate Ice Cream | Rich, smooth chocolate ice cream. |
| Desserts | Sweet Beeda | A traditional betel-leaf after-dinner treat with sweet, aromatic fillings. |

11 cards in 4 categories (Sweet 1, Starters 3, Mains 4, Desserts 3). Ice cream
is two cards by decision. Category titles and cards are centred (1, 3, 4, 3 on a wide screen). Navaratan Korma and Cucumber Raita are no longer cards: they are "Served with" sides.
Mains stays a single section, shown as one row of four (`columns: 4` in
menu.json). Cards keep the same size as in other categories: from 1040px wide the row
is widened past the page margins to fit all four (no scrolling); below that the
cards wrap two per row, since four full-size cards cannot fit a phone. Order: Phulka, Idiyappam, Brinji, Curd Rice. Note: the couple's original description of the
Special Curd Rice (grapes, raisins, pomegranate, pickle, mor milagai) is
deliberately not on the page; add it back if guests need it for allergies.

### 3. Image display - IN PREVIEW
Photos were not available, so freely licensed ones were sourced: Wikimedia Commons
for 12 dishes (CC BY-SA, credited on the page; Navaratan Korma is public domain)
and Pexels for Chocolate Ice Cream (no credit required). Brinji uses a Commons
vegetable biryani photo as a stand-in, since brinji is a Madras dish similar to veg
biryani and no photo of brinji itself exists. A "Photo coming soon" tile renders for
any dish without a photo. Files are Wikimedia's pre-scaled 960px JPEG thumbnails
in `public/images/menu/` (no WebP tooling on the dev machine), shown as square
`object-fit: cover` crops. Each item carries a `credit` (author, license, source)
in `menu.json`, and the page lists them under a "Photo credits" disclosure with a
note that photos are illustrative and were resized/cropped. Approximate matches to
review in preview: Bhindi Fry (crispy gram-flour okra), Idiyappam (shows coconut
milk, no kadalai curry), Sweet Beeda (plain photo of wrapped paan).
Constraints already identified:
- Only images with a licence that allows use on a public site (Unsplash, Pexels,
  Wikimedia Commons CC0 / CC-BY). No scraping from restaurant or recipe sites.
- Stock photos will resemble the dish, not be the actual dish. Decide whether
  that is acceptable or whether photos are placeholders until real ones exist.
- CC-BY images need visible attribution; keep a credits list in the repo.
- Files go in `public/images/menu/` (served path; same convention as
  `venue_image`), referenced by filename from `menu.json`. Normalised to WebP and
  a sensible max width so the page stays light.

### 4. Navigation - IN PREVIEW
Entry points to `/dinner-menu`:
Both use one shared component, `src/components/MenuButton.astro`: a 44px round
cutlery-icon button with a "View menu" tooltip on hover/focus, styled after the RSVP
toggle buttons (cream fill, teal outline, teal fill when pressed), pinned to the
right corner.
- `EventDetails.astro`: at the right end of the `btn-row`, opposite "Add to
  calendar".
- `/camera` landing page (`src/pages/camera/index.astro`): below the legal line, right
  corner. Not added to the camera screen (`/camera/camera`) itself, by decision, so it
  never interrupts shooting.

## Out of scope for now
Veg/non-veg or allergen markers, filters, the album gate, the reminder email.
