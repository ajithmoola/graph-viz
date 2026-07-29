# NetworkX Graph Viewer

Opens `*.graph.json` files (networkx node-link format) as an interactive 3D scene.
Nodes are placed at their `pos` coordinates, sized and colored by `radius` when present.
Hover a node to see its attributes. The view reloads automatically when the file changes.

Export a graph from Python:

```python
import json, networkx as nx
with open("mytree.graph.json", "w") as f:
    json.dump(nx.node_link_data(G), f)
```
