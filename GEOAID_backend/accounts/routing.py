"""Shortest-path routing for the DRRM evacuation map (Dijkstra).

Pure Python (no Django imports) so it can be unit-tested on its own.
views.py builds the graph from the database and calls
`find_evacuation_routes()`.

How the graph is modelled
-------------------------
* Node  = a barangay (its centroid) or an evacuation center.
* Edge  = a RoadSegment row linking two barangays (two-way), plus a short
          "connector" edge from each evacuation center to its barangay.
* Weight = road length (km) x a penalty for the road's current condition
           (clear 1.0 ... landslide risk 3.0), and optionally x a penalty
           for entering a barangay flagged high/critical in RiskArea.
           Segments marked "impassable" (or inactive) are left out of the
           graph completely, so Dijkstra can never route through them.

Dijkstra is run once from the start node, which gives the cheapest path to
EVERY evacuation center; the caller then picks the best open center that
still has room.
"""

import heapq
import itertools
import math

EARTH_RADIUS_KM = 6371.0088

# Straight-line distance between two barangay centroids is shorter than the
# real road, so auto-computed segment lengths are scaled by this factor.
ROAD_CIRCUITY = 1.3

# Average travel speed used to turn kilometres into an ETA.
AVG_SPEED_KMH = 25.0

# Multiplier applied to a segment's length depending on road condition.
# A "flooded" km counts as 2.5 km, so Dijkstra will happily take a clear
# road that is up to 2.5x longer instead. "impassable" is intentionally
# absent: those edges are removed from the graph.
CONDITION_MULTIPLIER = {
    "clear": 1.0,
    "passable": 1.25,
    "flooded": 2.5,
    "landslide_risk": 3.0,
}
BLOCKED_CONDITIONS = {"impassable"}

# Extra cost for routing INTO a barangay that DRRM has flagged at-risk.
RISK_MULTIPLIER = {"low": 1.0, "medium": 1.15, "high": 1.5, "critical": 2.0}


def haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two lat/lng points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def road_length_km(lat1, lng1, lat2, lng2):
    """Estimated road length between two points (straight line x circuity)."""
    return round(haversine_km(lat1, lng1, lat2, lng2) * ROAD_CIRCUITY, 3)


def condition_multiplier(condition):
    """None means the road cannot be used at all."""
    if condition in BLOCKED_CONDITIONS:
        return None
    return CONDITION_MULTIPLIER.get(condition, 1.0)


class Graph:
    """Adjacency-list graph: node -> list of edge dicts."""

    def __init__(self):
        self.adj = {}

    def add_node(self, node):
        self.adj.setdefault(node, [])

    def add_edge(self, a, b, distance_km, condition="clear", segment_id=None,
                 risk=None, kind="road"):
        """Add a two-way edge. `risk` maps node -> RISK_MULTIPLIER value and
        is applied to the destination end of each direction. Returns False
        (and adds nothing) if the road is impassable."""
        mult = condition_multiplier(condition)
        if mult is None:
            return False
        risk = risk or {}
        self.add_node(a)
        self.add_node(b)
        for src, dst in ((a, b), (b, a)):
            self.adj[src].append({
                "to": dst,
                "weight": distance_km * mult * risk.get(dst, 1.0),
                "distance_km": distance_km,
                # km adjusted for road condition only (no risk penalty) —
                # used for the ETA, since a risk flag steers the route
                # choice but doesn't slow the trip itself.
                "travel_km": distance_km * mult,
                "condition": condition,
                "segment_id": segment_id,
                "kind": kind,
            })
        return True


def dijkstra(graph, source):
    """Classic Dijkstra with a binary heap (O((V+E) log V)).

    Returns (dist, prev): dist[node] is the cheapest weighted cost from
    `source`; prev[node] = (previous_node, edge_dict) lets the path be
    rebuilt. Nodes that cannot be reached are absent from `dist`.
    """
    dist = {source: 0.0}
    prev = {}
    tie = itertools.count()  # keeps heap comparisons away from node values
    heap = [(0.0, next(tie), source)]
    done = set()

    while heap:
        d, _, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        for edge in graph.adj.get(u, ()):
            v = edge["to"]
            if v in done:
                continue
            nd = d + edge["weight"]
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = (u, edge)
                heapq.heappush(heap, (nd, next(tie), v))
    return dist, prev


def rebuild_path(prev, source, target):
    """Returns (nodes, edges) from source to target, or None."""
    if target == source:
        return [source], []
    if target not in prev:
        return None
    nodes, edges = [target], []
    cur = target
    while cur != source:
        p, edge = prev[cur]
        edges.append(edge)
        nodes.append(p)
        cur = p
    nodes.reverse()
    edges.reverse()
    return nodes, edges


def attach_virtual_start(graph, start_node, lat, lng, node_coords, candidates, k=2):
    """Connects a free-standing start point (a map click / GPS fix) to its
    `k` nearest barangay nodes with straight-line connector edges, so
    Dijkstra can begin from somewhere that isn't itself a barangay.
    `candidates` is a list of barangay node ids."""
    ranked = sorted(
        candidates,
        key=lambda n: haversine_km(lat, lng, *node_coords[n]),
    )[:k]
    graph.add_node(start_node)
    for n in ranked:
        d = round(haversine_km(lat, lng, *node_coords[n]) * ROAD_CIRCUITY, 3)
        graph.add_edge(start_node, n, d, "clear", kind="connector")
    return ranked


def find_evacuation_routes(graph, source, center_nodes):
    """Runs Dijkstra once and returns every reachable evacuation center,
    cheapest first:

        [{"center": <node>, "cost": float, "distance_km": float,
          "minutes": int, "nodes": [...], "edges": [...]}, ...]
    """
    dist, prev = dijkstra(graph, source)
    results = []
    for c in center_nodes:
        if c not in dist:
            continue
        path = rebuild_path(prev, source, c)
        if path is None:
            continue
        nodes, edges = path
        total_km = sum(e["distance_km"] for e in edges)
        cost_km = dist[c]  # weighted km (condition + risk penalties): what Dijkstra minimised
        travel_km = sum(e["travel_km"] for e in edges)
        results.append({
            "center": c,
            "cost": round(cost_km, 3),
            "distance_km": round(total_km, 2),
            # ETA follows road condition (a flooded km is slow) but not risk flags.
            "minutes": max(1, round(travel_km / AVG_SPEED_KMH * 60)),
            "nodes": nodes,
            "edges": edges,
        })
    results.sort(key=lambda r: r["cost"])
    return results