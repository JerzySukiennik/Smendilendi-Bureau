Build **Smendiłendi Bureau** — a browser game about running a small architecture
practice with 1–3 people. You take a commission, walk to your desk, design the
building in an in-game 3D editor on an in-game retro computer, submit it, get a
client e-mail listing what is wrong, fix it, and then walk through the finished
building together thirty years later while simulated people live in it.

Every decision I have already made is in `DESIGN-DECISIONS.md` next to this file.
Read it first. It is the contract, not a suggestion. Everything it does not
mention — architecture, decomposition, file layout, order of work — is yours.

The player this is made for is a practising architect. He must never catch the game
being wrong about his profession.

**The bar.** Three references, each one an agent can actually open and hold its own
output against, side by side:

- *Architect Life: A House Design Simulator* (Steam screenshots) — the bar for
  **finish, not style**. Our style stays clean low poly. The question a critic asks
  is whether our render has the same density of detail, the same considered lighting,
  the same lived-in richness and the same framing, achieved with low-poly means.
  "Ours is bare and flat" means another round.
- *SketchUp* (screenshots and docs) — the bar for **how the editor feels to use**.
  Count the clicks to place a wall, cut a door, change a material. Would an architect
  recognise the tools by name? Do dimension hints and snapping feel as natural?
  We copy the fluency, not the appearance.
- *Windows 95/98 and early Mac OS* (screenshots) — the bar for the fictional OS on
  the starter computer. It must read as genuinely of that era, not modern-with-a-filter.

Split the goal into the smallest pieces that can be improved and judged on their own.
For each piece that matters, fan out a builder and a **separate critic with fresh
context**. The critic inspects the real thing — the running game, a render, a
screenshot, a measured number — compares it directly against the bar, blind A/B where
possible, names the single biggest remaining gap, and sends it back. Keep looping until
our side wins or I stop the run. No fixed number of rounds.

Keep a simple live progress page showing the work evolving, so I can look in whenever
I want. Use subagents and ultracode. Build the whole thing in one continuous run —
do not stop at milestones for my approval. Stop only to have me sign off the key
assets, as `DESIGN-DECISIONS.md` describes.
