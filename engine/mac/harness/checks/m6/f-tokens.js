// (f) The theme on Auto under the Mac's appearance: the custom properties of :root (INJ.names, the palette names of
// styles/tokens.css) as computed with data-theme="auto", then with the theme INJ.as ("light" or "dark") set outright.
// They must be the same: Auto follows the Mac.
await quiet(6000);
const root = document.documentElement;
const read = () => Object.fromEntries(INJ.names.map((n) => [n, getComputedStyle(root).getPropertyValue(n).trim()]));
root.setAttribute("data-theme", "auto"); await frame();
const auto = read();
const scheme = getComputedStyle(root).colorScheme;
root.setAttribute("data-theme", INJ.as); await frame();
const fixed = read();
root.setAttribute("data-theme", "auto"); await frame();
const differ = INJ.names.filter((n) => auto[n] !== fixed[n]).map((n) => `${n}: auto ${auto[n]} / ${INJ.as} ${fixed[n]}`);
return { as: INJ.as, prefersLight: matchMedia("(prefers-color-scheme: light)").matches, colorScheme: scheme, compared: INJ.names.length, differ: differ.slice(0, 20), differCount: differ.length, bg: auto["--bg"] };
