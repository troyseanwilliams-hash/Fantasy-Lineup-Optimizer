---
name: Player configuration browser checks
description: Mobile browser regression testing caveats for wide player tables.
---
Chromium mobile emulation can pan its visual viewport independently after scrolling the wide player table. Locator clicks may then hit different elements despite a correct DOM bounding rectangle; keyboard Save activation remains reliable.

**Why:** Diagnostics showed visual viewport offsetTop moving while window.scrollY stayed zero, causing repeated pointer interception.

**How to apply:** Keep keyboard coverage, explicitly inspect visual viewport offsets when investigating touch failures, and do not replace assertions with forced clicks. Mock unrelated payment scripts rather than aborting them, because their rejected load promise opens the development error overlay.
