/**
 * The landing page's script: the community hall in the hero
 * (./community.js) and the globe further down (./globe.js), both fed from
 * #relay-data, which the server builds from the glossary
 * (src/lib/term-relay.ts). Nothing starts until the page has loaded.
 *
 * Imported by src/ui/pages/home.tsx as "./landing/island.js?island": the
 * loader in scripts/build-server.mjs bundles this module and its imports
 * into one minified script and hands it over as text, inlined like every
 * other island.
 */

import { onLoad } from "./gl.js"
import { mountCommunity } from "./community.js"
import { mountGlobe } from "./globe.js"

onLoad(() => {
  let data
  try {
    data = JSON.parse(document.getElementById("relay-data").textContent)
  } catch {
    return
  }
  const hero = document.getElementById("hero-scene")
  if (hero) mountCommunity(hero, data)
  for (const host of document.querySelectorAll("[data-globe]")) mountGlobe(host, data)
})
