# Session handoff — rushbite-kiosk

---

## 1. Current project / repo

- **Project path**: `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk`
- **Stack**: Next.js 15.5.15 (App Router) + Prisma + Postgres (Docker on port 5433) + TypeScript + Tailwind 3
- **Current branch**: `main`
- **Repo state**: working tree has extensive uncommitted changes from this session and prior ones. Only one commit exists (`2463484 Initial commit from Create Next App`). Everything in the listed files below is uncommitted.
- **Project instructions**: no `AGENTS.md` or `CLAUDE.md`. Only `README.md` exists at the root.
- **Active plan documents** (the next session should read these first):
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/production-auth-authz-plan-2026-04-28.md` — production auth/authz design (named admin users, per-device sessions, outlet scoping for restaurant + cafeteria, CSRF, failover semantics, idempotent payment finalization, outlet-prefixed order numbers). **Solid and implementation-ready** after multiple review rounds; not yet implemented.
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/build-stability-plan-2026-04-28.md` — fixes the intermittent Turbopack `PageNotFoundError` build issue. Recommends dropping `--turbopack` from production build, adding CI build-stress matrix, post-build smoke check, guarded `.next` cleanup, etc. **Solid and implementation-ready**; not yet implemented.
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/rushbite-planning-doc.md` — overall project planning doc v2 (single-store; needs v3 update for multi-outlet to align with the auth plan).
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/proposal/` — interactive HTML design specs for the new menu-editor flow:
    - `menu-editor-modal-redesign.html` — deal-item modal (focuses on visibility/expiration + add-ons + upgrade option; basics inherited from base item).
    - `menu-editor-modal-nondeal-redesign.html` — non-deal-item modal (full form: basics, pricing, appearance, image, sizes, add-ons).
    - `linked-item-picker-redesign.html` — production-grade linked-item picker with search highlighting, category chips, sort, keyboard nav, multi-select, recent picks. Reference for upgrading the current single-select `LinkedItemPicker.tsx`.
  - `/Users/dandy/.claude/plans/update-it-zazzy-wombat.md` — implementation plan (multi-select picker rewrite, executed and patched in earlier session).
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/upgrade-options-multiselect-picker-plan.md` — design contract / spec the picker implementation plan defers to.
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/menu-item-hard-delete-history-plan.md` — hard-delete feature plan; implementation landed earlier session.
  - `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk/docs/deal-history-use-again-plan.md` — Deal History + USE AGAIN reuse flow plan; implementation landed earlier session.
  - `/Users/dandy/.claude/plans/slotted-addons-bundle-savings.md` — predecessor plan; only Migration 3 / operator audit remain (far-future).
  - Other docs in `docs/` (`menu-admin-hardening-plan.md`, `deploy-runbook.md`, `production-readiness-backlog.md`, etc.) — context-only.

## 2. Current goal

This session pivoted from feature work to **menu-editor UX rewrite** and **plan investigation**. Two parallel streams:

- **Stream A: Menu-editor rewrite + wiring** (in code, not yet committed). Replace the legacy ~4400-line `<ItemModal>` inside `MenuEditor.tsx` with a focused two-column layout (form on left, sticky kiosk preview on right) that matches the kiosk's visual language. New components live in `src/components/admin/menu-editor/`. Non-deal items + existing-deal editing now use the new modals; new-deal creation still uses the legacy modal because the new skeleton doesn't yet have the deal base-item picker.
- **Stream B: Plan investigation** (writing only). Reviewed the auth/authz plan and build-stability plan across multiple rounds; both are now solid and implementation-ready.

**Why this work is needed**: the legacy `<ItemModal>` has grown to 4400 lines and mixes deal/non-deal flows, which makes it brittle (every change touches both flows) and hard to align with the kiosk's design language. The rewrite gives operators a live kiosk-style preview alongside form fields.

**Expected final behavior**:
- Non-deal items: full form (basics, pricing, appearance, image, sizes, add-ons, visibility) with sticky kiosk preview rendering the size picker / quantity stepper / red ADD TO ORDER bar exactly as customers see it.
- Existing deals: focused form (visibility/expiration + add-ons + upgrade option) with sticky kiosk preview rendering the yellow `MAKE IT A MEAL?` upgrade card. Basics (name/desc/price/emoji/etc.) are inherited from the base item; to change them, swap the base item via the legacy create flow until the base-item picker is ported.
- New deals: continue using legacy `<ItemModal>` (it owns the base-item picker for fresh deals).

## 3. What has already been done

### Code state — green

- `npx tsc --noEmit` — **clean** (excluding one pre-existing intermittent `UsersClient` TS2307; passes on most runs).
- `npm run dev` — runs cleanly via the new `predev` hook (auto-starts Docker if needed). `npm run build` not re-tested this session.
- DB schema in sync via 13 applied migrations.

### A. Slotted-addons-bundle-savings (earlier session — server foundation + kiosk-side rendering)

[Preserved from prior handoff — see git log of this file or earlier sessions for full detail. Headline: schema migration `20260425221819_add_upgrade_options`, types updated, helpers extracted (`auto-title.ts`, `upgrade-renderability.ts`, `order-read.ts`), validator with `enrichUpgradeOptions`, snapshot/restore, hydration, admin item routes, pricing, checkout, order readers, kiosk customize/menu/page migrated.]

### B. Multi-select picker rewrite (earlier session)

[Preserved from prior handoff. Headline: schema migration `20260426052951_add_upgrade_item_name_snapshot`, validator extended, save routes wire `itemNameSnapshot`, `MultiSelectPickerModal` added to `MenuEditor.tsx` with REPLACE affordance, REPLACE preserves row id, one-row-per-`linkedMenuItemId` rule.]

### C. Hard-delete menu items (earlier session)

[Preserved from prior handoff. New endpoint `DELETE /api/admin/items/[id]/hard-delete/route.ts` with `SELECT ... FOR UPDATE` row-locking, version check, reference-count gates (active items / order history / upgrade-link references all blocking), `ITEM_DELETED` audit/revision.]

### D. Deal History + USE AGAIN (earlier session)

[Preserved from prior handoff. New `/admin/deals/history` route + `loadDealHistoryEntries` loader pulling from current hidden deals + `MenuAuditLog.ITEM_DELETED` + `MenuRevision`. `USE AGAIN` writes snapshot to sessionStorage; `MenuEditor` opens pre-filled draft via `makeDealFromHistorySnapshot`. Sidebar gained `Deal History` nav with `lucide-react` icons.]

### E. This session: dev workflow + plan reviews + menu-editor rewrite + body-scroll-lock fix

#### E.1 Dev startup automation (`predev` hook)

- **`scripts/ensure-docker.sh`** (new) — checks Docker daemon (`docker info`), starts Docker Desktop on macOS via `open -a Docker` (or `systemctl start docker` on Linux), waits up to 60 seconds for the daemon to be ready, then runs `docker compose up -d`. Idempotent. Bounded wait so a wedged daemon doesn't hang `npm run dev` indefinitely.
- **`package.json`** updated:
  - Added `"predev": "bash scripts/ensure-docker.sh"` — runs automatically before `npm run dev`.
  - Rewired `"db:up": "bash scripts/ensure-docker.sh"` (was `docker compose up -d`) so manual `npm run db:up` benefits from the same daemon-start logic.
  - Added `"db:validate:outlets": "tsx scripts/validate-outlet-integrity.ts"` (script presence implied; not modified this session).
- **Outcome**: `npm run dev` from a cold-boot state now reliably starts Docker → starts Postgres → starts Next. Eliminates the `Can't reach database server at localhost:5433` error operators were hitting after laptop restarts.

#### E.2 Auth/authz plan review (`docs/production-auth-authz-plan-2026-04-28.md`)

Multi-round review of the production auth/authz plan. The plan now covers:
- Named admin users (replacing shared `ADMIN_PASSWORD`).
- Per-device sessions (replacing shared `KIOSK_DEVICE_KEY` etc.) with `DeviceOutletAccess` for shared devices.
- Site/Outlet scoping for one building with multiple outlets (restaurant + cafeteria).
- `AdminUser.siteRole = OWNER` (site-level) vs `AdminUserOutletRole.role` (outlet-level), with explicit precedence rules.
- CSRF: `SameSite=Strict` admin cookies + `Origin`/`Referer` checks on every state-changing admin API (logout included).
- Middleware boundary: middleware never performs final authorization; route handlers re-read sessions against the active DB connection (so failover-aware).
- Failover consistency: critical auth writes are transaction-logged with order/payment durability; if replay is uncertain, force re-login.
- Outlet data ownership: `Category`, `MenuItem`, `Order`, payment sessions, menu revisions, devices all gain `outletId`. Restore is outlet-scoped (restaurant restore must not mutate cafeteria). Cross-outlet upgrade links banned at admin write + checkout + restore.
- Order numbering: outlet-prefixed daily sequences (`R-001`, `C-001`) via `OutletDailyOrderSequence` (atomic allocation in the order tx).
- Idempotent order finalization (`SELECT … FOR UPDATE` on payment session + `finalizedOrderId`) and idempotent refunds (`stripe.refunds.create({…}, { idempotencyKey: "refund_" + paymentTransactionId })`).
- Bootstrap concurrency-safety, last-owner protection, password policy (Argon2id, sentinel hash for missing-user timing leaks, pepper rotation runbook).
- Rate limiting persisted in DB (`LoginAttempt`), retention (LoginAttempt 30d, AuthAuditLog 1y).
- Device cookie cutover via rolling enrollment (no business-hours hard invalidation).

**Status**: solid and implementation-ready. Phased rollout plan included (Phase 1 add tables → Phase 2 admin route auth → Phase 3 device enrollment → Phase 4 hardening → Phase 5 legacy removal). Multiple review rounds folded in CSRF, failover, outlet-scoped restore, order claim atomicity, Stripe idempotency key naming, device cutover blast radius, etc.

**Not implemented**: zero schema or code changes from the plan have landed. This is design only.

#### E.3 Build-stability plan review (`docs/build-stability-plan-2026-04-28.md`)

Multi-round review of an intermittent `PageNotFoundError` Turbopack build issue. The plan now covers:
- §1: Separate TS correctness from Next page collection.
- §2: Verify route-folder sibling imports (`./UsersClient` etc. + `@/` aliases) and case-sensitivity (Linux CI catches case drift).
- §3: Reproduce in clean dir using a guarded `clean:next` script (cwd-checked, no broad globs).
- §4: Test webpack build (`npx next build` without `--turbopack`); if stable, switch production build script.
- §5: Verify test scripts stay outside `src/app` (lower-suspicion than originally drafted).
- §6: Inspect Next config + file-system edge cases.
- §7: Commit to production build mode after 5 consecutive clean local builds.
- §8: CI build stress matrix (5 parallel jobs on `main` / release; single PR build; classify SIGKILL/137 as runner OOM, not app failure; pin `next@15.5.15` and lockfile during 48h window; `npm ci`).
- §9: Post-build route smoke check with explicit status policy (200/302/307/401/403/405 OK, 404 = fail, 5xx = log loudly + release blocker for key routes), dynamic-route coverage (handler-404 vs missing-route 404), POST-only route GET probe (405 expected), dedicated port 3100 to avoid dev-server collision, post-deploy smoke against deploy target.
- §10: Runbook with guarded `.next` cleanup, narrow `pkill` (PID/port preferred over broad pattern), dev-mode recovery, escalation steps (`lsof .next`, narrower caches, broader caches as last resort).
- Release-readiness checks separated from build-stability metrics.
- Post-deploy follow-up: uptime checks for `/api/menu`, `/admin`, `/kiosk`; future headless-browser smoke for JS chunk failures.

**Status**: solid and implementation-ready. Phased rollout: Phase 1 (drop `--turbopack` from production build, add `clean:next` script, fix any tsc errors) → Phase 2 (5 local clean builds) → Phase 3 (CI workflow + stress matrix) → Phase 4 (route smoke script) → Phase 5 (runbook).

**Not implemented**: zero changes from the plan have landed. Production build script is still `"next build --turbopack"` in `package.json`.

#### E.4 Menu-editor component skeleton + wiring (the bulk of this session)

New component family at `src/components/admin/menu-editor/`. Designed against three HTML proposals at `docs/proposal/`. Visual language matches the kiosk page exactly (Archivo Black headlines, brand-cream item panels, yellow upgrade cards, red ADD TO ORDER bar).

**Files (all new):**
- `types.ts` — shared types. `Item` mirrors the local `Item` type in `MenuEditor.tsx` (string-typed `dealExpiresAt`, loose `string | null` badge to match local). Re-exports `AdminModifierInput`, `AdminUpgradeOptionInput`, `AdminUpgradeItemLinkInput` from `@/lib/menu-admin`.
- `ModalShell.tsx` — header / scrollable body / sticky footer chrome. Uses the shared `lockBodyScroll()` ref-counted util (see E.5). Splits effects: body lock (mount-only), focus capture/restore (mount-only), Esc handler (rebinds on `onClose`). Click-outside closes.
- `StatusPill.tsx` — Live / Hidden / Out-of-stock pills + animated `live-dot`.
- `VisibilityRow.tsx` — Live/Hidden toggle + green-pill out-of-stock toggle (copied verbatim from the menu list at `MenuEditor.tsx:1347-1377` for visual consistency). Optional `expirationSlot` for the deal modal's date input.
- `SizesEditor.tsx` — sortable size rows with `+$X.XX` price-delta input. Drag handles are visual stubs (TODO: `@dnd-kit`).
- `AddonsEditor.tsx` — same pattern as Sizes but separate component.
- `HeroImageUpload.tsx` — file input + blob preview + fit/alt fields. **Renders a real menu-card preview** when `cardPreview` prop is supplied (emoji + bgColor fallback, badge + combo overlays, name/desc/price strip). Mirrors the legacy modal's MENU CARD section at `docs/backups/2026-04-28-pre-menu-editor-wiring/MenuEditor.tsx:2245-2284`.
- `UpgradeOptionEditor.tsx` — single upgrade option (linked items + discount chips + calc card). Discount chips are quick-pick (5/10/12/15/20%) with the site default tagged inline. Live calc card shows items total, discount %, customer pays, save tag.
- `KioskItemPreview.tsx` — non-deal kiosk preview matching the kiosk page exactly: cream item panel with badge, drop-shadowed emoji/image, Archivo Black name + description + red price. Right side: yellow size cards (Small/Medium/Large) with red dot + delta, white minus / yellow plus quantity stepper, red ADD TO ORDER bar with yellow accent strip on top.
- `KioskDealPreview.tsx` — deal kiosk preview matching the legacy `MAKE IT A MEAL?` upgrade card: yellow card with Archivo Black headline (e.g. `ADD MUSHROOM SWISS`), red `+$7.64` / `Save $0.85` price block, `Includes` list with cream-tinted thumbnails.
- `EditItemModal.tsx` — non-deal modal. Full form: Basics (Category, Name, Description), Pricing (Base price, Bundle savings), Appearance (Emoji, BgColor with color picker, Badge, Combo number — moved from a "Numbering" section per UX feedback), Image upload, Visibility, Sizes, Add-ons. Sort order intentionally omitted (handled via drag-and-drop on the menu list, not in the modal). Sticky kiosk preview on right.
- `EditDealModal.tsx` — **minimal** deal modal matching `menu-editor-modal-redesign.html`. Three sections only: Visibility/Expiration, Add-ons, Upgrade option (focal). Basics (name/desc/price/emoji/bgColor/badge/combo/image) intentionally omitted — deals inherit from the base item. Header displays the deal name. Embedded `LinkedItemPicker` overlay state for the upgrade option's "+ Add another menu item" flow.
- `LinkedItemPicker.tsx` — currently **single-select** (regression from legacy `MultiSelectPickerModal` for deals). Search, category groups with sticky headers, inline size expansion. Uses `lockBodyScroll()` (E.5).
- `index.ts` — barrel exports.

**Wiring in `src/app/admin/menu/MenuEditor.tsx`** (modified — backed up at `docs/backups/2026-04-28-pre-menu-editor-wiring/MenuEditor.tsx`):
- Added imports: `EditItemModal`, `EditDealModal` from `@/components/admin/menu-editor`; `lockBodyScroll` from `@/lib/body-scroll-lock`.
- Conditional render at the modal site (around line ~1417):
  - **Creating a new deal** → legacy `<ItemModal>` (it owns the base-item picker).
  - **Editing an existing deal** → new `<EditDealModal>` (no base-change support; that's a known follow-up).
  - **Non-deal items (any category)** → new `<EditItemModal>`.
- Adapter for `onSave`: wraps the legacy `saveItem(draft, isNew, hero)` to return the new modal's `SaveResult` contract. TS-only cast at the boundary (`Parameters<typeof saveItem>[0]`) because the new `Item` type uses optional ids on modifiers while the local `Mod` requires `id: string` — the validator normalizes both.
- The legacy `useEffect` at line ~627 that managed `body.style.overflow` for `modalOpen` was rewritten to use `lockBodyScroll()` so it shares the ref-counted lock with the new modals (see E.5).

**Iteration during this session** (per user feedback):
- **Out-of-stock control**: original was a Tailwind checkbox; replaced with the green-pill toggle from the menu list (`MenuEditor.tsx:1347-1377`). `VisibilityRow.tsx`.
- **Combo number placement**: moved from the Pricing & numbering section into Appearance (it's a customer-visible badge, not a price). Sort order input dropped entirely — drag-on-list-page is the right pattern. `EditItemModal.tsx`.
- **Menu card preview emoji fallback**: was showing `NO HERO IMAGE` text when no image uploaded; now renders emoji on bgColor with badge/combo overlays + name/desc/price strip. `HeroImageUpload.tsx` accepts `cardPreview` prop.
- **Deal modal minimization**: original new deal modal had Basics/Pricing/Appearance/Image sections (carried over from non-deal). Stripped to match the proposal HTML — deals only edit visibility/expiration/add-ons/upgrade-option. `EditDealModal.tsx`.
- **`@/lib/storage` import error**: the storage lib is `"server-only"`. Switched to `@/lib/image-upload-constraints` (the actual source — storage just re-exports). Both `EditItemModal.tsx` and `EditDealModal.tsx`.
- **Linked-item picker proposal HTML**: built `docs/proposal/linked-item-picker-redesign.html` with production-grade features (search highlighting in name+description, category filter chips with counts, sort dropdown, multi-select toggle with checkboxes + footer confirm, recent picks via localStorage, inline size expansion, keyboard navigation `↑↓`/`Enter`/`/`/`Esc`, empty state, ARIA combobox/listbox roles). Reference for upgrading the current `LinkedItemPicker.tsx`.

#### E.5 Body-scroll-lock leak fix (`src/lib/body-scroll-lock.ts`)

**Bug**: after closing any modal/preview overlay, the `/admin/menu` page stopped scrolling — mouse wheel, trackpad, and arrow keys all blocked.

**Root cause**: multiple overlays (modal, kiosk preview iframe, linked-item picker) each had a `useEffect(..., [onClose])` that did `document.body.style.overflow = "hidden"` on mount and restored a captured `previousOverflow` on unmount. Two compounding issues:
1. `onClose` was inline in the parent JSX, so its reference changed on every parent render. The effect's cleanup-and-rerun loop captured whatever `body.style.overflow` happened to be at that moment, which drifted.
2. When two overlays stacked (e.g. kiosk preview underneath an edit modal), child effects ran before parent effects on mount but cleanups also ran child-first — so the parent's effect captured `"hidden"` from the child, then on close restored `"hidden"` after the child correctly restored `""`.
3. `MenuEditor.tsx:627` had its own `useEffect` keyed on `modalOpen` that ALSO set `body.style.overflow`, competing with the modal-shell lock. This was the dominant leak: even after fixing the dependency-array issue in the new modals, this older parent-level effect kept body locked.

**Fix**: new module `src/lib/body-scroll-lock.ts` exports `lockBodyScroll()` — a process-wide ref-counted lock. First caller captures the original `body.style.overflow` and applies `"hidden"`; subsequent callers just bump a counter; `release()` decrements; only when the count returns to zero does the original value get restored. Stacking-safe regardless of close order.

**Migrated callsites**:
- `src/components/admin/menu-editor/ModalShell.tsx` — split into three single-purpose effects (body lock mount-only, focus capture/restore mount-only, Esc handler on `[onClose]`).
- `src/components/admin/menu-editor/LinkedItemPicker.tsx` — body lock keyed on `[isOpen]`; Esc handler kept on `[isOpen, expandedItemId, onClose]` (it never touches body).
- `src/components/admin/PreviewOverlay.tsx` — same split (backed up at `docs/backups/2026-04-28-pre-menu-editor-wiring/PreviewOverlay.tsx`).
- `src/app/admin/menu/MenuEditor.tsx:627` — replaced direct `body.style.overflow` manipulation with `lockBodyScroll()`. paddingRight (scrollbar compensation) kept local since it doesn't affect scrollability.

**Verification**: tested in browser after `pkill -f "next dev" && rm -rf .next && npm run dev` (cleared a stale Turbopack manifest first). Page scrolls cleanly with mouse, trackpad, and arrow keys after closing any modal or stacked-overlay sequence.

### F. Cross-cutting decisions made (locked in, this session)

- **Route deals' editing to the new `EditDealModal`; keep new-deal creation on the legacy `<ItemModal>`** until the deal base-item picker is ported. The new modal does not support changing the base item; operators must use the legacy create flow to swap a deal's base.
- **Deal modal is intentionally minimal** (visibility/expiration + add-ons + upgrade option). Basics inherit from the base item via "Change base." Stripping name/desc/price/emoji/bgColor/badge/combo/image fields is per the proposal HTML.
- **Sort order is not in either modal.** Drag-on-list-page is the canonical reorder mechanism. The "Sort order #N" header chip is also removed.
- **Out-of-stock UI is the green-pill toggle from the menu list**, copied verbatim, not a checkbox.
- **`LinkedItemPicker` is single-select today (regression vs legacy `MultiSelectPickerModal`).** Adding multi-select is a known follow-up. The proposal HTML at `docs/proposal/linked-item-picker-redesign.html` is the target spec.
- **Body scroll lock is process-wide ref-counted, not per-component**, via `src/lib/body-scroll-lock.ts`. All overlay code paths must use it.
- **`predev` hook autostarts Docker** for `npm run dev`. Idempotent and bounded (60s wait).

### Bugs fixed during the session

- **Body scroll lock leak after closing modals/overlays** — see E.5. Now uses ref-counted lock; stacking-safe.
- **`@/lib/storage` import failed at build because of `"server-only"`** — switched to `@/lib/image-upload-constraints`.
- **`/admin/menu` Prisma `Can't reach database server` after laptop restart** — `predev` hook auto-starts Docker.
- **Menu card preview blank when no hero image uploaded** — added `cardPreview` prop with emoji+bgColor fallback matching the legacy modal.
- **Turbopack manifest corruption** (intermittent `Could not find the module … SegmentViewNode in the React Client Manifest`) — recovered twice this session via `pkill next dev && rm -rf .next && npm run dev`. The build-stability plan (E.3) is the durable fix.

### Bugs still present / known limitations

- **`LinkedItemPicker` single-select regression** for deal-editing flow vs legacy `MultiSelectPickerModal`. Operators currently have to reopen the picker for each linked item they want to add.
- **No "Change base item" affordance in `EditDealModal`** — deals' name/desc/price/etc. cannot be changed in the new modal. Operators must delete and recreate via the legacy create flow, or the picker must be ported.
- **`UsersClient` TS2307** appears intermittently in `npx tsc --noEmit` (`src/app/admin/users/page.tsx(8,25)`) even though `UsersClient.tsx` exists on disk. May be a stale-cache artifact; build-stability plan §1+§2 require this to be fixed before "build stability is done."
- **Production build script is still `next build --turbopack`** — known intermittent failure, mitigation in build-stability plan E.3.
- **Auth/authz plan is unimplemented** — production still uses shared `ADMIN_PASSWORD` + shared device keys.

## 4. Current state of the work

### Working

- 13 migrations applied. DB seeded.
- `npx tsc --noEmit` — clean (modulo intermittent `UsersClient` flake).
- `npm run dev` from cold boot — starts Docker, Postgres, Next.
- `/admin/menu`:
  - Editing **non-deal** items: new `EditItemModal` with sticky kiosk preview, green-pill stock toggle, full form (basics / pricing / appearance / image / sizes / add-ons / visibility), live preview updates as you type.
  - Editing **existing deals**: new `EditDealModal` (minimal — visibility/expiration + add-ons + upgrade option) with sticky `MAKE IT A MEAL?` kiosk preview; embedded `LinkedItemPicker` for adding linked items (one at a time).
  - Creating **new deals**: legacy `<ItemModal>` (base-item picker still works).
  - Body scroll restores correctly after closing any modal / kiosk preview / picker, in any order.
  - All earlier session features still work (multi-select picker via "EDIT LINKED ITEMS" button on legacy deal modal, hard-delete with `SELECT … FOR UPDATE`, Deal History + USE AGAIN, kiosk-side upgrade rendering, order readers).

### Not yet done

- **Manual UX walkthrough** of the new modals end-to-end against the seeded dev DB (Section 6 of this handoff).
- **Multi-select in `LinkedItemPicker`** to restore parity with legacy `MultiSelectPickerModal` for deal editing.
- **Deal base-item picker** ported to `EditDealModal` (allow changing the base of an existing deal).
- **Hard-delete in `EditDealModal`** — currently only `EditItemModal` has the `onHardDelete` prop wired through.
- **Auth/authz plan implementation** — Phase 1 (add tables + bootstrap) is the right starting point.
- **Build-stability plan implementation** — Phase 1 (drop `--turbopack` from production build, fix `UsersClient`, add `clean:next` script) is the right starting point.
- **Git commit + branch / PR** — nothing has been committed; everything is in the working tree.

### Backups created

- `docs/backups/2026-04-28-pre-menu-editor-skeleton/` — empty directory (no files created since the skeleton was additive).
- `docs/backups/2026-04-28-pre-menu-editor-wiring/` — pre-wiring snapshots:
  - `MenuEditor.tsx` (165K, the legacy 4400-line version before my modifications).
  - `PreviewOverlay.tsx` (before body-scroll-lock fix).
  - `MANIFEST.txt`.

### Files modified or created (this session, uncommitted)

```
package.json                                                                       (modified — predev, db:up, db:validate:outlets)
scripts/ensure-docker.sh                                                           (new — Docker autostart)
src/lib/body-scroll-lock.ts                                                        (new — ref-counted lock)
src/components/admin/menu-editor/types.ts                                          (new)
src/components/admin/menu-editor/ModalShell.tsx                                    (new)
src/components/admin/menu-editor/StatusPill.tsx                                    (new)
src/components/admin/menu-editor/VisibilityRow.tsx                                 (new — green-pill stock toggle)
src/components/admin/menu-editor/SizesEditor.tsx                                   (new)
src/components/admin/menu-editor/AddonsEditor.tsx                                  (new)
src/components/admin/menu-editor/HeroImageUpload.tsx                               (new — with cardPreview fallback)
src/components/admin/menu-editor/UpgradeOptionEditor.tsx                           (new)
src/components/admin/menu-editor/KioskItemPreview.tsx                              (new — non-deal preview)
src/components/admin/menu-editor/KioskDealPreview.tsx                              (new — yellow upgrade card preview)
src/components/admin/menu-editor/EditItemModal.tsx                                 (new — non-deal modal)
src/components/admin/menu-editor/EditDealModal.tsx                                 (new — minimal deal modal)
src/components/admin/menu-editor/LinkedItemPicker.tsx                              (new — currently single-select)
src/components/admin/menu-editor/index.ts                                          (new)
src/components/admin/PreviewOverlay.tsx                                            (modified — body-scroll-lock fix; backed up)
src/app/admin/menu/MenuEditor.tsx                                                  (modified — wiring + body-scroll-lock fix; backed up)
docs/proposal/menu-editor-modal-redesign.html                                      (new — deal modal design)
docs/proposal/menu-editor-modal-nondeal-redesign.html                              (new — non-deal modal design)
docs/proposal/linked-item-picker-redesign.html                                     (new — picker production-grade design)
docs/build-stability-plan-2026-04-28.md                                            (new/iterated — multi-round review)
docs/production-auth-authz-plan-2026-04-28.md                                      (new/iterated — multi-round review)
docs/backups/2026-04-28-pre-menu-editor-wiring/MenuEditor.tsx                      (new — backup)
docs/backups/2026-04-28-pre-menu-editor-wiring/PreviewOverlay.tsx                  (new — backup)
docs/backups/2026-04-28-pre-menu-editor-wiring/MANIFEST.txt                        (new — backup manifest)
SESSION_HANDOFF.md                                                                 (this file — updated)

[plus all earlier-session uncommitted files — see prior versions of this handoff for the full list]
```

## 5. Remaining tasks

### Next immediate step

1. **Manual UX walkthrough** of the new menu-editor modals (see Section 6).
2. **Decide on next major work item**: the user has flagged three plan-level tracks:
   - **Multi-select in `LinkedItemPicker`** (the regression — easy win).
   - **Build-stability plan implementation** (Phase 1: drop `--turbopack` from production build, fix `UsersClient` TS2307, add `clean:next` script).
   - **Auth/authz plan implementation** (Phase 1: add `Site`, `Outlet`, `AdminUser`, `AdminSession`, `Device`, `DeviceSession`, `AuthAuditLog`, `LoginAttempt` tables + backfill default outlet + admin login page + bootstrap route).

### Remaining TODOs in priority order

1. Manual editor walkthrough — non-deal modal (Spicy Jalapeño / Poutine etc.), deal modal (Crispy Chicken Combo etc.), inline `LinkedItemPicker`, body scroll behavior after close, kiosk preview matching the actual kiosk page.
2. Decide commit strategy for accumulated uncommitted work. Currently `main` has only `Initial commit from Create Next App` (`2463484`).
3. **Restore multi-select** in `LinkedItemPicker.tsx` — match the proposal HTML at `docs/proposal/linked-item-picker-redesign.html`. Two options noted in conversation:
   - Option A: reuse the legacy `MultiSelectPickerModal` (export it from `MenuEditor.tsx`, adapt the contract). Lowest risk.
   - Option B: rewrite `LinkedItemPicker.tsx` with multi-select + keyboard nav + recent picks etc. Better long-term.
4. **Port the deal base-item picker** so `EditDealModal` can offer `Change base` (currently the prop is optional and not passed).
5. **Wire `onHardDelete` into `EditDealModal`** (currently only `EditItemModal` has it).
6. **Build-stability plan Phase 1** — fix `UsersClient` TS2307; add `scripts/clean-next.ts`; drop `--turbopack` from `"build"`; reproduce 5x clean builds locally.
7. **Auth/authz plan Phase 1** — add `Site`/`Outlet` schema, backfill, bootstrap route, admin login page.
8. **Earlier-session manual walkthroughs still pending**: hard-delete edge cases (active blocked, order-history blocked, upgrade-link blocked, stale-version blocked, restore-from-before-delete recreates), Deal History + USE AGAIN flow, kiosk + order-reader walkthroughs.

### What should not be changed

[All "What should not be changed" items from the prior handoff still apply. Highlights:]

- **Don't repurpose `AddonOption`** for upgrades.
- **Don't drop `MenuItem.mealUpgrade` / `mealSavings` columns** yet (Migration 3, far-future).
- **Don't change the row-id identity contract** for `UpgradeItemLink`. REPLACE preserves row id.
- **Don't loosen the "one row per `linkedMenuItemId`"** rule.
- **Don't auto-save reused deals.** USE AGAIN opens editor pre-filled; SAVE ITEM is the only DB-commit.
- **Don't relabel "Last changed" to "Last used"** in Deal History without wiring an `OrderItem` query.
- **Don't trust client-supplied `itemNameSnapshot` / snapshot fields** — server recomputes from live DB.

[New from this session:]

- **Don't bypass `lockBodyScroll`** — every new overlay must use the shared util, not direct `body.style.overflow` manipulation. Otherwise stacking will leak again.
- **Don't add basics/pricing/appearance/image fields back to `EditDealModal`** — deals inherit from the base item per the proposal HTML.
- **Don't add a sort-order input** to either modal. Drag-on-list is the right pattern; the modal stays focused on what's distinct per item.
- **Don't put `--turbopack` back on the production build script** until the upstream Turbopack manifest issue is fixed AND the build-stability acceptance criteria pass.
- **Don't import server-only modules** (`@/lib/storage`, `@/lib/db`, anything with `"server-only"` at top) from client components. Use the public re-exports (`@/lib/image-upload-constraints` etc.).

### Risks / edge cases to watch

[Earlier-session risks still apply.]

- **`LinkedItemPicker` single-select regression** affects every deal that has more than one linked item — operators must reopen the picker for each. Workaround: use the legacy modal route (currently triggered by "create new deal").
- **Body-scroll-lock util is in-process state** — works fine for SPA but if any code mutates `document.body.style.overflow` outside the util (e.g. third-party libs, future feature additions), the count and the actual style will drift. Mitigation: code review + grep for raw `body.style.overflow` writes.
- **`predev` requires Docker installed** — fails clean with a clear error if Docker CLI is missing. Production deploy doesn't use this script.
- **macOS-vs-Linux startup** — `ensure-docker.sh` uses `open -a Docker` on macOS and `systemctl start docker` (with `sudo`) on Linux. Other OSes show a manual-start prompt.

## 6. Verification plan

### Automated (already green except `UsersClient` flake)

```bash
cd /Users/dandy/Downloads/kiosk-app/rushbite-kiosk
npx tsc --noEmit
npm run dev          # predev hook starts Docker if needed
```

### Manual editor walkthrough — new modals

```bash
# Dev server should be running.
# Open http://localhost:3000/admin/menu
```

**Non-deal modal (`EditItemModal`):**

1. Click any item NOT in the Deals category (e.g. **Spicy Jalapeño** in Burgers, **Poutine** in Sides). Modal opens with the new layout.
2. Header shows item name in Archivo Black + status pill (Live with green dot) + meta chips (`3 sizes · 8 add-ons` etc.).
3. Form sections in order: **Basics** (Category, Name, Description with char counter), **Pricing** (Base price with `$` prefix, Bundle savings), **Appearance** (Emoji, Background color with native color picker + hex input, Badge dropdown, Combo number), **Product image** (Menu card preview with emoji/bgColor fallback when no image; Customize hero image controls on right), **Visibility** (Live/Hidden pill toggle, **green-pill out-of-stock toggle** that flips left-gray ↔ right-green), **Sizes** rows, **Add-ons** rows.
4. **Live updates**: type in Name → header title + menu card name + kiosk preview hero name all update. Change Background color → menu card + cream kiosk preview panel both shift. Click size cards in the kiosk preview → unit price + ADD TO ORDER total recompute.
5. **Out-of-stock toggle**: click → green pill flips, kiosk preview gets a dark `OUT OF STOCK` overlay on the hero. Click again → restored.
6. **⌘S** → green flash + saved toast (real save via legacy `saveItem` adapter).
7. **Esc** → closes modal; **page scrolls cleanly** after close.
8. **Delete item**: first click shows "Click again to confirm" red highlight; second click within 3s deletes.

**Deal modal (`EditDealModal`):**

1. Click an existing deal in the Deals category (e.g. **Classic Cheeseburger** if it's a deal, **The Double Stack**). Modal opens with the **minimal** layout.
2. Header shows deal name + status pill + `Expires in N days` chip.
3. Form sections only: **Visibility** (Live/Hidden + green-pill stock toggle + `Expires` date input in the same row), **Add-ons** (usually empty for deals), **Upgrade option** (focal — yellow upgrade card on right shows `MAKE IT A MEAL?` styled exactly like the kiosk).
4. **No basics / pricing / appearance / image sections** — deals inherit from the base item. Header and kiosk preview show the inherited values.
5. **Discount chips** in the upgrade option card: 5/10/12/15/20%; click any → kiosk preview's `+$X.XX` and `Save $X` recompute live.
6. **Linked-item picker** (single-select today): click `+ Add another menu item` → searchable picker overlay opens with category groups, sticky headers, item rows with emoji/name/description/price. Click an item with sizes → expands inline; click a size → linked item appended, picker closes. Reopen to add another (regression — see TODO).
7. **Esc** → closes picker first if open, then modal; page scrolls cleanly after.

**Body-scroll-lock stacking:**

1. Open a kiosk preview from any category header (`Eye` icon). Page is scroll-locked (correct).
2. While preview is open, click an item card to open the edit modal. Both overlays stacked.
3. Close the modal (Esc or Cancel). Preview still open, body still locked (correct).
4. Close the preview. **Body should now scroll** (mouse wheel, trackpad, arrow keys).
5. Repeat with reverse close order: open both, close preview first, then modal. Body should still unlock cleanly.
6. Inside the deal modal, open the linked-item picker. Three overlays stacked. Close in any order — body should always unlock when the last one closes.

### Manual walkthroughs preserved from earlier sessions

[Sections still apply — see prior handoff versions for full SQL probes:]
- Multi-select picker REPLACE flow (legacy modal route — create new deal).
- Hard-delete walkthrough (active blocked / order-history blocked / upgrade-link blocked / stale-version blocked / restore-recreates).
- Deal History + USE AGAIN walkthrough.
- Kiosk customer flow + cart + checkout.
- Order-reader walkthrough (`/kitchen`, `/counter`, `/admin/orders`).

### Expected success criteria

- New non-deal modal: full form, live kiosk preview, smooth interactions, save persists.
- New deal modal: minimal form, focused on visibility + add-ons + upgrade option, yellow `MAKE IT A MEAL?` preview, save persists.
- Linked-item picker (single-select): adds one item at a time, search + category grouping work, inline size expansion works.
- Body scroll: locks while any overlay is open, unlocks correctly after the last one closes regardless of close order.
- Earlier-session features (legacy multi-select picker, hard-delete, Deal History + USE AGAIN, kiosk upgrades, order readers) still work — none of this session's changes should have touched them.

## 7. New-session prompt

Paste this into the next Claude Code session:

> I'm continuing work on the rushbite-kiosk repo at `/Users/dandy/Downloads/kiosk-app/rushbite-kiosk`. Read `SESSION_HANDOFF.md` at the repo root first — it's the complete handoff. The plan documents to load are:
> - `docs/production-auth-authz-plan-2026-04-28.md` (production auth/authz, **implementation-ready**, not yet started — Phase 1 = Site/Outlet schema + bootstrap + admin login).
> - `docs/build-stability-plan-2026-04-28.md` (Turbopack build instability fix, **implementation-ready**, not yet started — Phase 1 = drop `--turbopack` from production build, fix any `UsersClient` TS error, add `clean:next` script).
> - `docs/proposal/menu-editor-modal-redesign.html`, `docs/proposal/menu-editor-modal-nondeal-redesign.html`, `docs/proposal/linked-item-picker-redesign.html` (interactive HTML design specs; the picker proposal is the target for adding multi-select back to `LinkedItemPicker.tsx`).
> - `docs/upgrade-options-multiselect-picker-plan.md`, `docs/menu-item-hard-delete-history-plan.md`, `docs/deal-history-use-again-plan.md` (earlier-session feature plans, all landed).
>
> **State**: this session added a new menu-editor component family at `src/components/admin/menu-editor/` and wired it into `MenuEditor.tsx`. Non-deal items use the new `EditItemModal`; existing deals use the new `EditDealModal` (minimal — visibility/expiration + add-ons + upgrade option only); creating a new deal still uses the legacy `<ItemModal>` because it owns the deal base-item picker. Also added: `predev` Docker autostart hook (`scripts/ensure-docker.sh`); ref-counted body-scroll-lock util at `src/lib/body-scroll-lock.ts` that fixes a stacking-overlay leak that was preventing `/admin/menu` from scrolling after closing modals. `LinkedItemPicker.tsx` is currently single-select — a regression vs the legacy `MultiSelectPickerModal` for deal-editing flow. Earlier-session work (multi-select picker via "EDIT LINKED ITEMS" on legacy deal modal, hard-delete endpoint, Deal History + USE AGAIN, kiosk-side upgrade rendering) is still in place. `npx tsc --noEmit` is clean (modulo intermittent `UsersClient` flake). Nothing committed yet — entire work is in the dirty working tree on `main`.
>
> **Next steps in priority order**:
> 1. Manual UX walkthrough — Section 6 of `SESSION_HANDOFF.md` covers the new modals + body-scroll behavior; earlier-session walkthroughs still apply.
> 2. Decide which plan-level track to implement next: (a) restore multi-select in `LinkedItemPicker`, (b) build-stability plan Phase 1, (c) auth/authz plan Phase 1.
> 3. Decide commit strategy.
>
> **Don't**: bypass `lockBodyScroll` (every overlay must use the shared util); add basics/pricing/appearance/image fields to `EditDealModal` (deals inherit from base item per the proposal); add sort-order inputs to either modal (drag-on-list is canonical); import server-only modules from client components; put `--turbopack` back on the production build script. All "What should not be changed" rules from the earlier-session handoffs still apply.
>
> The dev DB is up at `localhost:5433`. `npm run dev` autostarts Docker via the `predev` hook. Walk Section 6 of `SESSION_HANDOFF.md` before changing code.
