"use client";

import { useCallback } from "react";
import { forceCollide, forceX, forceY } from "d3-force";
import ForceGraph2D from "react-force-graph-2d";

/**
 * Thin wrapper so the graph can be lazy-loaded: next/dynamic doesn't forward refs, so the instance ref
 * travels as `fgRef`. Also sets the layout forces as soon as the instance exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ForceGraphCanvas({ fgRef, ...props }: { fgRef: React.RefObject<any> } & Record<string, any>) {
  const attach = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance: any) => {
      fgRef.current = instance;
      if (!instance) return;
      // Notes push apart. A note's fact dots sit in a ring around it (the orbit force) and the note keeps
      // room for that ring, so zooming in opens the note up instead of piling its facts on each other.
      instance.d3Force("charge")?.strength((n: Orbiting) => (n.detail ? 0 : -60));
      // Linked notes sit just outside each other's rings, never inside them.
      instance.d3Force("link")
        ?.distance((l: OrbitLink) => (l.detail ? 0 : Math.max(50, reach(l.source) + reach(l.target))))
        .strength((l: OrbitLink & { predicate?: string }) => (l.detail ? 0 : l.predicate === "mentions" ? 0.12 : 0.4));
      instance.d3Force("orbit", orbit());
      instance.d3Force("collide", forceCollide((n: Orbiting) => (n.detail ? 0 : reach(n))).strength(1).iterations(3));
      // A gentle pull to the centre keeps notes without links next to the rest instead of drifting off.
      instance.d3Force("x", forceX(0).strength(0.06));
      instance.d3Force("y", forceY(0).strength(0.06));
    },
    [fgRef],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ForceGraph2D ref={attach} {...(props as any)} />;
}

type OrbitLink = { detail?: boolean; source: Orbiting; target: Orbiting };
/** How much room a note needs: its ring plus the fact labels around it (about 24 characters), or a small margin. */
const reach = (n: Orbiting) => (n.ring ? n.ring + 60 : 14);

type Orbiting = { id: string; x?: number; y?: number; vx?: number; vy?: number; detail?: boolean; parent?: string; ring?: number; dx?: number; dy?: number };

/** Keeps each fact dot at its fixed spot on its note's ring, wherever the note moves. */
function orbit() {
  let byId = new Map<string, Orbiting>();
  let dots: Orbiting[] = [];
  const force = () => {
    for (const d of dots) {
      const p = byId.get(d.parent!);
      if (!p || p.x === undefined || p.y === undefined) continue;
      d.x = p.x + d.dx!;
      d.y = p.y + d.dy!;
      d.vx = d.vy = 0;
    }
  };
  force.initialize = (nodes: Orbiting[]) => {
    byId = new Map(nodes.map((n) => [n.id, n]));
    dots = nodes.filter((n) => n.detail);
    const groups = new Map<string, Orbiting[]>();
    for (const d of dots) groups.set(d.parent!, [...(groups.get(d.parent!) ?? []), d]);
    for (const [parent, list] of groups) {
      const ring = byId.get(parent)?.ring || Math.max(20, list.length * 3.4);
      list.forEach((d, i) => {
        const angle = -Math.PI / 2 + (i / list.length) * 2 * Math.PI;
        d.dx = Math.cos(angle) * ring;
        d.dy = Math.sin(angle) * ring;
      });
    }
  };
  return force;
}
