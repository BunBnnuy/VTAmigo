# Project notes

## Frontend visual design

`frontend/DESIGN.md` is the source of truth for colors, fonts, and window
chrome (buttons, inputs, toggles, titlebars). Read it before making any
visual change to `frontend/src/**`, and keep it in sync if a design
decision changes — component styles should reference the CSS custom
properties defined in `frontend/src/index.css` rather than hardcoding hex
values.
