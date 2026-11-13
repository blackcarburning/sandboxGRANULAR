# Phone edge controls

Build v2026.11.13.PHONE-EDGES.4 has seven right-edge shortcuts: Song, Mega,
Sparse, Keys, Layers, Mix and Play/Stop. DAW and Actions remain in the full Jump
menu, not on the edge. Every shortcut is 34px wide. Play/Stop is longer only:
104px minimum height and its existing larger 12px lettering; the other six retain
52px minimum height and their existing lettering. Surfaces are opaque shaded
colour gradients, darker than build .3; Play is red and running Stop is green.
The left Baker/Pot captions keep their explicit two-line lettering.

Phone app-container side padding reserves clear gutters for both 34px edge
rails, including safe-area insets. Do not enlarge a vertical control's width when
only extra length is requested, or rely on a screenshot of an empty card to
prove clearance. Check real populated card controls and arrow hit targets.

`navigation-palette.js` mounts distinct-ID mirrors outside the Jump drawer so
focus does not open the drawer or hide a tapped shortcut. Mirrors invoke the
original menu controls and observe disabled/label/pressed/transport/theme state.
The edge caption is Play while the authoritative transport caption is Start.
The shared Jump list and original handlers remain authoritative.

The strip remains visible when Jump opens, travelling with its reserved left
gutter using the drawer's transform timing. Jump itself stays a narrow vertical
edge handle above that strip, not a full-width panel header; search stays fixed
above the single scrolling list. The landscape shortcut scroller keeps every
shortcut reachable. Phone rails remain hidden on desktop.

The main pointerdown close handler treats these external edge mirrors as panel
interactions. Pin a focus-only open drawer before focus leaves it, and clear its
close timer, because otherwise Safari moves the tapped shortcut before click.
Keep actual menu nodes/listeners intact. Modal close click-through guards still
close/guard the drawer; do not bypass them for a cancelled dialog.

The actual left mirror IDs are `historyEdgeMasterBakerBtn` and
`historyEdgeCookingPotBtn`. Their explicit newlines and scoped pre-line rule
make two vertical text columns, independently of menu-button labels.

The shared effect-input label inventory names P as Piano and O as Orch.
Source values, routing, audio, saved state and Song render identity are unchanged.

Run `node tests/phone-edge-controls-browser.cjs` and
`node tests/phone-edge-clearance-browser.cjs` against a disposable server with
the isolated admin fixture, via BASE=http://127.0.0.1:PORT/mygrain/ and
MYGRAIN_TEST_OUTPUT pointing to an evidence directory. Never use production
accounts for these regressions. Chromium and WebKit cover narrow/wide portrait,
landscape and rotation back, open-panel alignment/hit targets and real taps,
search/menu/resize, two-column text, populated Pot containment and arrow hit
targets, trusted reorder/restore, opaque shading and red/green transport. Physical
iPhone remains separate.
