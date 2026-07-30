/**
 * Autonomous exploration → application map. Reconstruct an app's screens,
 * navigation graph, information architecture, hubs, dead-ends, and unexercised
 * affordances from exploratory sessions — perception only, no app source.
 */

export {
  type ApplicationMap,
  type AppScreen,
  buildApplicationMap,
  type MapTransition,
} from "./appmap.js";
export { renderApplicationMapMarkdown, renderApplicationMapMermaid } from "./report.js";
