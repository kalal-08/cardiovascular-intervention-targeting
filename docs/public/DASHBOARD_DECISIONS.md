# Dashboard decisions

## Scientific presentation

- Overview separates trial population, allocation and the adjusted average effect.
- Risk vs Benefit uses one selector-driven scatterplot on common fixed axes. Changing the benefit signal does not turn baseline risk into a causal effect or recompute frozen correlations.
- HTE Validation separates supported prioritization from superiority not demonstrated. Calibration, participant agreement and classical subgroup results answer different questions.
- Rollout shows full capacity curves, pointwise intervals and a random expectation. Inspection does not change the selected policy/capacity. Full capacity is reconciliation, not optimization.
- Robustness keeps the three policy signals and rankings fixed. Focus policy changes the highlighted ranking, not the underlying analytical values. Coverage is descriptive.

## Identity and interaction

GRF uses navy `#0B2E83`, Simple HTE uses teal `#0798A5`, and Baseline Risk uses the Power BI orange `#F28C00`. Labels and graphical symbols supplement color. A small readable teal-text adjustment is retained where implemented. [Validation](VALIDATION.md#known-limitations) records accessibility scope.

Shared navigation follows Overview → Risk vs Benefit → HTE Validation → Rollout → Robustness. Clicking the static header surface activates its keyboard navigation scope. Left/Right operates while the header surface or a page-navigation control has focus, stops at boundaries, ignores modified shortcuts/held-key repeats and focuses the active page link after switching. Up/Down and arrows outside that scope retain native behavior. Mouse links, Enter, Tab and browser history remain available; hover alone does not activate navigation.

The village table uses a normal arrow cursor. Hover lightly highlights without selecting; click selects one row, re-click clears it, and selecting another replaces it. Keyboard activation and Escape are supported. Selection follows Village ID through sorting and policy changes while the page remains mounted; it does not filter other panels.

Tooltips expose essential estimates, intervals, counts and qualifications through pointer/focus access, with Escape dismissal and touch alternatives. Placement prefers available space with a viewport-bounded fallback. Native tables and chart-value disclosures retain access when dense plots or narrow screens require scrolling. No content is clipped merely to force a one-screen layout.

See [architecture](ARCHITECTURE.md) for state ownership, [validation](VALIDATION.md) for tested scope and [Power BI specification](../../powerbi/PUBLIC_README.md) for approved static outputs.

## Viewport adaptation

Layout responds to the browser's usable CSS viewport, not the physical monitor, device name or operating-system display scale. The approved large-monitor composition remains the reference. At 1280–1600 px widths the shared header uses a bounded brand column and one navigation row; narrower widths retain reflow. Compact desktop spacing responds to both width and height, with bounded viewport-relative padding, gaps and selected display sizes. This is not global zoom, a transformed canvas or hidden overflow.

Pages 1–3 share compact desktop spacing, preserving charts, complete evidence and qualifications. The review target includes complete initial evidence at 1440×768 and nearby desktop viewports at 100% zoom. Shorter or narrower windows may still scroll once readable layout bounds are reached. Pages 4–5 retain side-by-side evidence where readable, natural page scrolling, 340 px Rollout plots and the scrollable village table with sticky headers. Resize must preserve selectors, URL state, chart instances and selected Village ID. Narrow-screen reflow does not imply universal mobile optimization; [validation](VALIDATION.md#manual-and-historical-browser-evidence) separates manual review from automated coverage.

Compact scatterplots use the model-specific Y-axis label “GRF-predicted benefit” or “Simple HTE-predicted benefit”, with “(percentage points)” on the second line. Full intervention wording remains in the chart heading. Larger monitor and narrow-chart labels retain their existing wording; label adaptation changes no values or axes.
