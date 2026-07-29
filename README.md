# NetworkX Graph Viewer

A VS Code extension that opens networkx graphs as an interactive 3D scene.
Works in local and Remote-SSH/WSL sessions.

Any file matching `*.graph.json` (networkx node-link format) opens in the viewer
instead of the JSON editor:

- Nodes are placed at their `pos` coordinates (3D or 2D)
- Sphere size is proportional to the node's `radius` attribute
- Color identifies connected components (largest = blue, then orange, aqua, …;
  components beyond 8 are gray)
- Hover a node to see its id, component, and all attributes
- Drag to orbit, scroll to zoom, right-drag to pan
- The view reloads automatically when the file changes on disk

## Install

Download the `.vsix` from the [latest release](https://github.com/ajithmoola/graph-viz/releases)
and run:

```sh
code --install-extension nx-graph-viewer-<version>.vsix
```

On a Remote-SSH machine, run this in the integrated terminal so it installs on
the remote side, then reload the window.

## Exporting a graph

```python
import json, networkx as nx

with open("mytree.graph.json", "w") as f:
    json.dump(nx.node_link_data(G), f)
```

### Format details

- `nodes[].id` — required; ints or strings
- `nodes[].pos` — optional `[x, y, z]` or `[x, y]`; any units. Nodes without
  `pos` fall back to a sphere layout
- `nodes[].radius` — optional number, same units as `pos`; missing → uniform size
- `edges` / `links` — both keys accepted (networkx ≥ 3.6 writes `edges`);
  only `source`/`target` are used
- Other node attributes are shown in the hover tooltip
- Everything must be JSON-serializable — numpy integers are not; use
  `json.dump(..., default=int)` if needed

## Building from source

```sh
npm install
npm run build
npx vsce package
```

This produces the installable `.vsix`.
